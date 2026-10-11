import { frameworkError } from '../../../engine/shared/framework-error.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { prepareCompaction } from './compaction.js';
import { compactMessages, type CompactionNotice } from '../../../engine/shared/compaction/index.js';
import { projectMonsoonContext } from './active-context.js';
import { MonsoonContextPort } from './context-port.js';
import { acquireMonsoonSessionLease } from '../runtime/session-lease-adapter.js';
import type { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';

export type MonsoonCompactionSummarizer = (input: {
  dataDir: string; model: string; dialogText: string; signal: AbortSignal;
  onChunk: (content: string) => void;
  onOutputLimited?: () => void;
  prompt?: string; maxOutputTokens?: number; maxContentTokens?: number;
}) => Promise<string>;

export interface PreparedMonsoonCompaction {
  compressedCount: number;
  dispose?(): void;
  run(input: { signal: AbortSignal; onChunk: (content: string) => void;
    onNotice?: (notice: CompactionNotice) => void }): Promise<{
    markerId: string; markerIdx: number;
  }>;
}

export class MonsoonCompactionService {
  constructor(
    private readonly dataDir: string,
    private readonly sessions: FileMonsoonSessionRepository,
    private readonly summarize: MonsoonCompactionSummarizer,
    private readonly resolveSummaryBudget?: (model: string) => Promise<number | undefined>,
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
      run: async ({ signal, onChunk, onNotice }) => {
        try {
          let saved = session;
          const plan = await compactMessages({ dataDir: this.dataDir, area: 'monsoon', model,
            kind: 'conversation', prompt: agent?.compactionPrompt, protectedPrefixCount: 0,
            scopeKey: `monsoon:${session.id}`, messages: projectMonsoonContext(session),
            mode: 'full', reason: 'manual', signal, onNotice, onSummaryChunk: onChunk,
            resolveSummaryBudget: this.resolveSummaryBudget,
            archive: (before, reason) => port.archive(session.agentId, session.id, before, reason),
            summarize: request => this.summarize({ dataDir: this.dataDir, model: request.model,
              dialogText: request.text, prompt: request.prompt, maxOutputTokens: request.maxOutputTokens,
              maxContentTokens: request.maxContentTokens,
              onOutputLimited: request.onOutputLimited,
              signal, onChunk: request.onChunk ?? (() => {}) }),
            commit: async commit => { saved = await port.commit(session.agentId, session.id,
              prepared.expectedRevision, commit, 0); },
          });
          if (!plan) throw new Error('没有可压缩的对话内容');
          const marker = saved.messages[saved.messages.length - 1]!;
          return { markerId: marker.id, markerIdx: saved.messages.length - 1 };
        } finally { release(); }
      } };
  }
}
