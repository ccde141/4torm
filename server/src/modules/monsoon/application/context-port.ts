import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import type { CompactionCommit, CompactionReason } from '../../../engine/shared/compaction/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { MonsoonSession } from '../domain/session.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { projectMonsoonContext, storedMonsoonContext } from './active-context.js';
import { hydrateMonsoonContext, persistMonsoonContext, persistMonsoonMessageImages,
  type StoredMonsoonContextMessage } from './context-images.js';

export type MonsoonContextMarker = {
  id: string; role: 'system'; content: string; timestamp: string;
  type: 'compact-marker'; contextExact: true; nativeContext: StoredMonsoonContextMessage[];
};

/** Stable cross-island port: archive records and active model context have separate ownership. */
export class MonsoonContextPort {
  private readonly sessions: FileMonsoonSessionRepository;
  constructor(private readonly dataDir: string) {
    this.sessions = new FileMonsoonSessionRepository(dataDir);
  }

  read(agentId: string, sessionId: string): Promise<MonsoonSession | null> {
    return this.sessions.get(agentId, sessionId);
  }

  activeContext(session: Pick<MonsoonSession, 'messages'>): ContextMessage[] {
    return projectMonsoonContext(session);
  }

  modelContext(session: Pick<MonsoonSession, 'id' | 'agentId' | 'messages'>): Promise<ContextMessage[]> {
    return hydrateMonsoonContext(this.dataDir, session.agentId, session.id, storedMonsoonContext(session));
  }

  async archive(agentId: string, sessionId: string, before: ContextMessage[],
    reason: CompactionReason): Promise<void> {
    const current = await this.read(agentId, sessionId);
    if (!current) throw new Error('会话不存在');
    const directory = path.join(this.dataDir, 'agents', agentId, 'sessions', `${sessionId}.compactions`);
    const file = `${Date.now()}-${randomUUID()}.json`;
    await fs.mkdir(directory, { recursive: true });
    await atomicWriteFile(path.join(directory, file), JSON.stringify({
      version: 1, reason, archivedAt: new Date().toISOString(),
      session: { ...current, messages: current.messages.map(persistMonsoonMessageImages) },
      context: persistMonsoonContext(before),
    }));
  }

  async commit(agentId: string, sessionId: string, expectedRevision: number,
    plan: CompactionCommit, protectedPrefixCount = 1, signal?: AbortSignal): Promise<MonsoonSession> {
    signal?.throwIfAborted();
    const current = await this.read(agentId, sessionId);
    if (!current) throw new Error('会话不存在');
    const marker: MonsoonContextMarker = { id: `msg-${randomUUID()}`, role: 'system',
      content: plan.summary, timestamp: new Date().toISOString(), type: 'compact-marker',
      contextExact: true, nativeContext: persistMonsoonContext(plan.messages.slice(protectedPrefixCount)) };
    let index = -1;
    for (let cursor = current.messages.length - 1; cursor >= 0; cursor--) {
      if (current.messages[cursor].runCommitted === false && current.messages[cursor].role === 'assistant') {
        index = cursor; break;
      }
    }
    const messages = [...current.messages];
    messages.splice(index < 0 ? messages.length : index, 0, marker);
    return this.sessions.replace({ ...current, messages }, expectedRevision, 'content',
      { clearTokenUsage: true, signal });
  }
}
