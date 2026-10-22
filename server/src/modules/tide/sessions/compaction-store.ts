import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { migrateOldTideSessions, updateTideSessionIndex } from './session-migration.js';
import { readOwnedTideSession } from './session-reader.js';
import { tideTaskSessionDir } from './session-paths.js';
import type { TideSession } from './session-types.js';

/** The task lease owns writes. Index preparation precedes the sole active-context replacement. */
export async function commitTideCompaction(dataDir: string, task: { id: string; name: string },
  original: TideSession, next: TideSession, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await migrateOldTideSessions(dataDir, original.agentId, task.id, task.name);
  const dir = tideTaskSessionDir(dataDir, original.agentId, task.id, task.name);
  await fs.mkdir(dir, { recursive: true });
  await assertOriginal(dataDir, task, original);
  await updateTideSessionIndex(dir, original.id);
  signal?.throwIfAborted();
  const file = path.join(dir, `${original.id}.json`);
  await assertOriginal(dataDir, task, original);
  await atomicWriteFile(file, JSON.stringify(next, null, 2), signal);
  // Rename is the commit point; a late abort must not pretend the original is still active.
}

async function assertOriginal(dataDir: string, task: { id: string; name: string }, original: TideSession) {
  const current = await readOwnedTideSession(dataDir, original.agentId, original.id, task);
  if (!current || JSON.stringify(current.messages) !== JSON.stringify(original.messages)) {
    throw new Error('压缩期间潮汐会话已发生变化，原文未更改');
  }
}
