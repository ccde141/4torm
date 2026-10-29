import { frameworkError } from '../../../engine/shared/framework-error.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { prepareCompaction } from './compaction.js';
import { compactMessages, type CompactionNotice,
  type CompactionProgress } from '../../../engine/shared/compaction/index.js';
import { MonsoonContextPort } from './context-port.js';
import { acquireMonsoonSessionLease } from '../runtime/session-lease-adapter.js';
import type { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import type { ModelRequestUsageEvent } from '../../../engine/shared/model-request-usage.js';
import { withMonsoonCompactionUsage } from './compaction-usage.js';
import type { CompactionRequestContext } from '../../../engine/shared/compaction/contracts.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import type { MonsoonSession } from '../domain/session.js';

export type MonsoonCompactionSummarizer = (input: {
  dataDir: string; model: string; dialogText: string; signal: AbortSignal;
  onChunk: (content: string) => void;
  onOutputLimited?: () => void;
  prompt?: string; maxOutputTokens?: number; maxContentTokens?: number; maxReasoningTokens?: number;
  messages: ContextMessage[];
  tools?: CompactionRequestContext['tools'];
  historyToolTransport?: CompactionRequestContext['historyToolTransport'];
}) => Promise<string>;

export type MonsoonCompactionContextBuilder = (input: {
  dataDir: string; session: MonsoonSession; agent: LoadedAgent | null;
  model: string; messages: ContextMessage[];
}) => Promise<CompactionRequestContext>;

export interface PreparedMonsoonCompaction {
  compressedCount: number;
  dispose?(): void;
  run(input: { signal: AbortSignal; onChunk: (content: string) => void;
    onNotice?: (notice: CompactionNotice) => void;
    onModelRequest?: (event: ModelRequestUsageEvent) => void;
    onProgress?: (progress: CompactionProgress) => void | Promise<void> }): Promise<{
    markerId: string; markerIdx: number;
  }>;
}

export class MonsoonCompactionService {
  constructor(
    private readonly dataDir: string,
    private readonly sessions: FileMonsoonSessionRepository,
    private readonly summarize: MonsoonCompactionSummarizer,
    private readonly resolveSummaryBudget?: (model: string) => Promise<number | undefined>,
    private readonly buildContext?: MonsoonCompactionContextBuilder,
  ) {}

  async prepare(input: { agentId: string; sessionId: string; model?: string }): Promise<PreparedMonsoonCompaction> {
    const release = acquireMonsoonSessionLease(input.agentId, input.sessionId);
    if (!release) throw frameworkError({ code: 'MONSOON_SESSION_BUSY', kind: 'conflict',
      message: '会话正在执行中', source: 'monsoon.compaction', retryable: false });
    try { return await this.prepareReserved(input, release); }
    catch (error) { release(); throw error; }
  }

  private async prepareReserved(input: { agentId: string; sessionId: string; model?: string },
    release: () => void): Promise<PreparedMonsoonCompaction> {
    const session = await this.sessions.get(input.agentId, input.sessionId);
    if (!session) throw frameworkError({ code: 'MONSOON_SESSION_NOT_FOUND', kind: 'not_found',
      message: '会话不存在', source: 'monsoon.compaction', retryable: false });
    let prepared;
    try { prepared = prepareCompaction(session); }
    catch (error) {
      throw frameworkError({ code: 'MONSOON_COMPACTION_UNAVAILABLE', kind: 'validation',
        message: (error as Error).message, source: 'monsoon.compaction', retryable: false },
      { cause: error });
    }
    const model = input.model || session.model || (await loadAgent(this.dataDir, input.agentId))?.model;
    if (!model) throw frameworkError({ code: 'MONSOON_COMPACTION_MODEL_MISSING', kind: 'validation',
      message: '无法确定模型，请配置 Agent 模型', source: 'monsoon.compaction', retryable: false });
    const port = new MonsoonContextPort(this.dataDir);
    const agent = await loadAgent(this.dataDir, input.agentId);
    return { compressedCount: prepared.compressedCount, dispose: release,
      run: async ({ signal, onChunk, onNotice, onProgress, onModelRequest }) => {
        try {
          let saved = session;
          const messages = await port.modelContext(session);
          const summaryContext = this.buildContext ? await this.buildContext({
            dataDir: this.dataDir, session, agent, model, messages,
          }) : { messages: [{ role: 'system' as const, content: session.systemPrompt }] };
          const plan = await withMonsoonCompactionUsage(this.sessions, { agentId: session.agentId, sessionId: session.id },
            () => compactMessages({ dataDir: this.dataDir, area: 'monsoon', model,
            kind: 'conversation', prompt: agent?.compactionPrompt, protectedPrefixCount: 0,
            scopeKey: `monsoon:${session.id}`, messages,
            summaryContext,
            mode: 'full', reason: 'manual', signal, onNotice, onProgress, onSummaryChunk: onChunk,
            resolveSummaryBudget: this.resolveSummaryBudget,
            archive: (before, reason) => port.archive(session.agentId, session.id, before, reason),
            summarize: request => this.summarize({ dataDir: this.dataDir, model: request.model,
              messages: request.messages, tools: request.tools, historyToolTransport: request.historyToolTransport,
              dialogText: request.text, prompt: request.prompt, maxOutputTokens: request.maxOutputTokens,
              maxContentTokens: request.maxContentTokens,
              maxReasoningTokens: request.maxReasoningTokens,
              onOutputLimited: request.onOutputLimited,
              signal, onChunk: request.onChunk ?? (() => {}) }),
            commit: async (commit, commitSignal) => { saved = await port.commit(session.agentId, session.id,
              prepared.expectedRevision, commit, 0, commitSignal); },
          }), onModelRequest);
          if (!plan) throw new Error('近期原文均受保护，没有更早历史可供压缩');
          const marker = [...saved.messages].reverse().find(message => message.type === 'compact-marker'
            && message.content === plan.summary && !session.messages.some(old => old.id === message.id));
          if (!marker) throw new Error('压缩记录未写入会话');
          return { markerId: marker.id, markerIdx: saved.messages.findIndex(message => message.id === marker.id) };
        } finally { release(); }
      } };
  }
}
