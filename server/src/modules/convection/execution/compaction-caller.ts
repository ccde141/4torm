import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { callLLM } from '../../../engine/shared/llm-bridge.js';
import { createCompactionCaller, estimateCompactionTokens, serializeCompactionMessages, type CompactionCommit, type CompactionNotice } from '../../../engine/shared/compaction/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import type { LLMCaller } from '../../../engine/shared/react/native-loop.js';
import { saveSession, sessionWorkspace, type ConvectionSessionData, type ConvectionMessage } from '../infrastructure/session-store.js';
import { convectionRoundBoundaries, retainedConvectionRecords } from './compaction-context.js';
import type { ConvectionEventSink } from './stream-events.js';
import { rememberChairContextBoundary, clearConvectionChairContext, convectionChairBoundaries } from './chair-context.js';
import { recordConvectionCompaction } from '../application/compaction-progress.js';
import { retainConvectionDisplay } from '../application/display-history.js';

interface CallerOptions {
  dataDir: string;
  session: ConvectionSessionData;
  agent: LoadedAgent;
  chair: LoadedAgent;
  kind: 'public' | 'chair';
  emit?: ConvectionEventSink;
  initialPromptTokens?: number;
  messages: ContextMessage[];
  displayDraft?: (compaction: { id: string; summary: string }, modelContent: string) => ConvectionMessage;
}

/** Called under the existing session lease: manual, threshold and overflow share one owner. */
export function createConvectionCompactionCaller(options: CallerOptions): LLMCaller {
  const { dataDir, session, agent, chair, kind, emit } = options;
  const llm: LLMCaller = { call: (messages, callOptions, onChunk, signal, tools, onReasoning, onToolProgress) =>
    callLLM({ dataDir, fullModelKey: agent.model, messages, options: { temperature: agent.temperature, ...callOptions },
      onChunk, signal, tools, onReasoning, onToolProgress }) };
  return createCompactionCaller({ llm, dataDir, area: 'convection', model: agent.model,
    kind: 'meeting', chairModel: chair.model, recentHumanTurns: kind === 'public' ? 3 : 4,
    prompt: chair.compactionPrompt, protectedPrefixCount: 1,
    scopeKey: `convection:${session.id}:${kind}`,
    initialPromptTokens: options.initialPromptTokens
      ?? (kind === 'public' ? session.tokenUsage : session.chairTokenUsage)?.promptTokens,
    initialEstimateTokens: kind === 'chair' ? session.chairRequestEstimate
      ?? estimateCompactionTokens(options.messages.slice(0, -1))
      : estimateCompactionTokens(options.messages.slice(0, session.publicMessages.length
        - [...session.publicMessages].reverse().findIndex(record => record.speaker === '人类'))),
    boundaries: context => kind === 'public' ? convectionRoundBoundaries(context, session.publicMessages)
      : convectionChairBoundaries(context),
    archive: async (before, reason) => {
      const file = path.join(sessionWorkspace(dataDir, session.id), 'bak',
        `${Date.now()}-${randomUUID()}-${kind}-compact.json`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWriteFile(file, JSON.stringify({ reason, publicMessages: session.publicMessages,
        chairMessages: kind === 'chair' ? session.chairMessages : [], modelMessages: before }));
    },
    commit: (plan, signal) => commitCompaction(options, plan, signal),
    onNotice: async notice => recordNotice(options, notice),
    onProgress: event => recordConvectionCompaction(session, kind, event,
      next => saveSession(dataDir, next), (_sessionId, _scope, progress) => emit?.(progress)),
  });
}

async function commitCompaction(options: CallerOptions, plan: CompactionCommit, signal?: AbortSignal): Promise<void> {
  const { dataDir, session, kind } = options;
  const next: ConvectionSessionData = { ...session };
  const field = kind === 'chair' ? 'chairCompactionProgress' : 'compactionProgress';
  const progress = next[field];
  if (progress?.type === 'compact-start') next[field] = { ...progress, type: 'compact-done',
    updatedAt: Date.now(), summaryLength: plan.summary.length, archivedMessages: plan.prefix.length };
  if (kind === 'chair') {
    next.chairActiveContext = structuredClone(plan.messages.slice(1));
    rememberChairContextBoundary(next);
    next.chairTokenUsage = undefined;
  } else {
    next.publicMessages = [{ speaker: '系统', content: `[对话历史摘要]\n${plan.summary}`, timestamp: Date.now(), compactionId: progress?.id },
      ...retainedConvectionRecords(session.publicMessages, plan, 1)];
    retainConvectionDisplay({ ...session, publicExecutionDraft: undefined }, next, next.publicMessages[0]);
    if (options.displayDraft && progress?.id) {
      next.publicExecutionDraft = options.displayDraft({ id: progress.id, summary: plan.summary },
        serializeCompactionMessages(plan.messages.slice(1 + next.publicMessages.length)));
    }
    next.tokenUsage = undefined;
    next.publicLatestTokenUsage = undefined;
    next.publicUsageIncomplete = undefined;
    clearConvectionChairContext(next);
    next.chairTokenUsage = undefined;
  }
  await saveSession(dataDir, next, signal);
  Object.assign(session, next);
}

async function recordNotice(options: CallerOptions, notice: CompactionNotice): Promise<void> {
  const next = { ...options.session, ...(options.kind === 'chair'
    ? { chairCompactionNotice: notice } : { compactionNotice: notice }) };
  await saveSession(options.dataDir, next);
  Object.assign(options.session, next);
  options.emit?.(notice);
}
