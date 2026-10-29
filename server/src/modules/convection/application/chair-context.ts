import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { compactMessages } from '../../../engine/shared/compaction/index.js';
import type { CompactionProgress } from '../../../engine/shared/compaction/contracts.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { sessionWorkspace, type ConvectionSessionData } from '../infrastructure/session-store.js';
import { buildConvectionChairContext, clearConvectionChairContext, rememberChairContextBoundary } from '../execution/chair-context.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { convectionChairDisplayMessages } from './display-history.js';
import { buildConvectionChairMessages } from '../execution/request-context.js';

/** Called only while the session's mutation lease is held. Public history is independent. */
export async function changeConvectionChairContext(
  dataDir: string, session: ConvectionSessionData, mode: 'clean' | 'summary',
  save: (next: ConvectionSessionData, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal, completed?: CompactionProgress,
): Promise<{ ok: true; archived: string; summary?: string }> {
  const archived = `${Date.now()}-${randomUUID()}-chair-${mode}.json`;
  const directory = path.join(sessionWorkspace(dataDir, session.id), 'bak');
  await fs.mkdir(directory, { recursive: true });
  await atomicWriteFile(path.join(directory, archived), JSON.stringify({
    publicMessages: session.publicMessages, chairMessages: session.chairMessages,
    chairActiveContext: session.chairActiveContext, chairTokenUsage: session.chairTokenUsage, mode,
    chairDisplayHistory: session.chairDisplayHistory, chairDisplayContextCount: session.chairDisplayContextCount,
  }));
  const compacted = mode === 'summary' ? await summarizeChair(dataDir, session, save, signal) : undefined;
  const summary = compacted?.summary;
  signal?.throwIfAborted();
  if (completed) completed.updatedAt = Date.now();
  const next: ConvectionSessionData = { ...session, chairTokenUsage: undefined, chairCompactionProgress: completed,
    chairMessages: summary ? [...session.chairMessages,
      { role: 'system', content: `[历史压缩记录]\n${summary}` }] : [],
  };
  if (summary) {
    next.chairActiveContext = structuredClone(compacted!.messages.slice(1));
    next.chairDisplayHistory = [...convectionChairDisplayMessages(session), next.chairMessages.at(-1)!];
    next.chairDisplayContextCount = next.chairMessages.length;
    rememberChairContextBoundary(next);
  } else {
    next.chairDisplayHistory = undefined; next.chairDisplayContextCount = undefined;
    clearConvectionChairContext(next);
  }
  await save(next, signal);
  Object.assign(session, next);
  return { ok: true, archived, ...(summary ? { summary } : {}) };
}

async function summarizeChair(
  dataDir: string, session: ConvectionSessionData,
  save: (next: ConvectionSessionData) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ summary: string; messages: ContextMessage[] }> {
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair?.model) throw new Error('会议助理未配置可用模型');
  const plan = await compactMessages({ dataDir, area: 'convection', kind: 'meeting',
    model: chair.model, chairModel: chair.model, prompt: chair.compactionPrompt, protectedPrefixCount: 1,
    scopeKey: `convection:${session.id}:chair`, recentHumanTurns: 4,
    messages: buildConvectionChairMessages(session, chair.name),
    reason: 'manual', mode: 'full', signal, onNotice: async notice => {
      session.chairCompactionNotice = notice;
      await save(session);
    },
  });
  if (!plan?.summary) throw new Error('没有可压缩的会议助理会话');
  return { summary: plan.summary, messages: plan.messages };
}
