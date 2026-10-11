import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { compactMessages } from '../../../engine/shared/compaction/index.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { sessionWorkspace, type ConvectionSessionData } from '../infrastructure/session-store.js';
import { buildConvectionChairContext, clearConvectionChairContext, rememberChairContextBoundary } from '../execution/chair-context.js';

/** Called only while the session's mutation lease is held. Public history is independent. */
export async function changeConvectionChairContext(
  dataDir: string, session: ConvectionSessionData, mode: 'clean' | 'summary',
  save: (next: ConvectionSessionData) => Promise<void>,
): Promise<{ ok: true; archived: string; summary?: string }> {
  const archived = `${Date.now()}-${randomUUID()}-chair-${mode}.json`;
  const directory = path.join(sessionWorkspace(dataDir, session.id), 'bak');
  await fs.mkdir(directory, { recursive: true });
  await atomicWriteFile(path.join(directory, archived), JSON.stringify({
    publicMessages: session.publicMessages, chairMessages: session.chairMessages,
    chairActiveContext: session.chairActiveContext, chairTokenUsage: session.chairTokenUsage, mode,
  }));
  const summary = mode === 'summary' ? await summarizeChair(dataDir, session, save) : undefined;
  const next: ConvectionSessionData = { ...session, chairTokenUsage: undefined,
    chairMessages: summary ? [{ role: 'system', content: `[历史压缩记录]\n${summary}` }] : [],
  };
  if (summary) {
    next.chairActiveContext = structuredClone(next.chairMessages);
    rememberChairContextBoundary(next);
  } else clearConvectionChairContext(next);
  await save(next);
  Object.assign(session, next);
  return { ok: true, archived, ...(summary ? { summary } : {}) };
}

async function summarizeChair(
  dataDir: string, session: ConvectionSessionData,
  save: (next: ConvectionSessionData) => Promise<void>,
): Promise<string> {
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair?.model) throw new Error('会议助理未配置可用模型');
  const plan = await compactMessages({ dataDir, area: 'convection', kind: 'meeting',
    model: chair.model, chairModel: chair.model, prompt: chair.compactionPrompt, protectedPrefixCount: 1,
    messages: buildConvectionChairContext(session, { role: 'system', content: '' }),
    reason: 'manual', mode: 'full', onNotice: async notice => {
      session.chairCompactionNotice = notice;
      await save(session);
    },
  });
  if (!plan?.summary) throw new Error('没有可压缩的会议助理会话');
  return plan.summary;
}
