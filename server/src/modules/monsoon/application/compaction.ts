import type { MonsoonMessage, MonsoonSession } from '../domain/session.js';
import { activeMonsoonMessages, projectMonsoonContext } from './active-context.js';
import { serializeCompactionMessages, splitCompactionMessages } from '../../../engine/shared/compaction/index.js';

export interface PreparedCompaction {
  expectedRevision: number;
  compressedCount: number;
  insertIndex: number;
  dialogText: string;
}

export function prepareCompaction(session: MonsoonSession): PreparedCompaction {
  const active = activeMonsoonMessages(session);
  if (!active.length) throw new Error('没有可压缩的对话内容');
  const split = splitCompactionMessages(projectMonsoonContext(session), {
    mode: 'full', prefixRatio: 1, protectedPrefixCount: 0,
  });
  if (!split) throw new Error('近期原文均受保护，没有更早历史可供压缩');
  const dialogText = serializeCompactionMessages(split.prefix);
  return {
    expectedRevision: session.revision,
    compressedCount: split.prefix.length,
    insertIndex: session.messages.length,
    dialogText,
  };
}

export function applyCompaction(
  session: MonsoonSession,
  prepared: PreparedCompaction,
  summary: string,
  markerId: string,
): MonsoonSession {
  if (session.revision !== prepared.expectedRevision) throw new Error('压缩所依据的会话版本已经变化');
  const marker: MonsoonMessage = {
    id: markerId, role: 'system', type: 'compact-marker', content: summary,
    timestamp: new Date().toISOString(),
  };
  const messages = [...session.messages];
  messages.splice(prepared.insertIndex, 0, marker);
  const compacted = { ...session, messages, updatedAt: new Date().toISOString() };
  delete compacted.tokenUsage;
  return compacted;
}
