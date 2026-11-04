import path from 'node:path';
import { registerCompactWork } from '../../../engine/shared/memory-recall/index.js';
import { recallDirectory, readRecallJson, recallObject, writeRecallJson, withRecallLock } from '../../../engine/shared/memory-recall/storage.js';
import { FileMonsoonSessionRepository } from './session-repository.js';
import { recallWorkInput } from '../application/recall-source.js';

interface Progress { version: 1; sessions: Record<string, number | string> }
/** Rebuild only from durable markers. Pre-summary archives and failed attempts are never indexed as successes. */
export async function syncMonsoonRecallRecords(dataDir: string, agentId: string, signal?: AbortSignal): Promise<void> {
  const file = path.join(recallDirectory(dataDir, agentId), 'monsoon-index.json');
  await withRecallLock(file, async () => {
    const progress = await readRecallJson(file, (value): value is Progress => recallObject(value) && value.version === 1
      && recallObject(value.sessions) && Object.values(value.sessions).every(item => typeof item === 'string' || Number.isSafeInteger(item)))
      ?? { version: 1 as const, sessions: {} };
    const sessions = new FileMonsoonSessionRepository(dataDir);
    const metadata = await sessions.listMetadata(agentId);
    const pending: Array<{ sessionId: string; id: string; timestamp: string }> = [];
    const stamp = (item: typeof metadata[number]) => JSON.stringify([item.compactions ?? -1, item.sourceVersion ?? '', item.title]);
    const changed = metadata.filter(item => progress.sessions[item.id] !== stamp(item));
    for (const item of changed) {
      signal?.throwIfAborted();
      const session = await sessions.get(agentId, item.id);
      for (const marker of session?.messages ?? []) if (marker.type === 'compact-marker' && marker.content.trim()) {
        pending.push({ sessionId: item.id, id: marker.id, timestamp: marker.timestamp });
      }
    }
    pending.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
    let loaded: Awaited<ReturnType<typeof sessions.get>> = null;
    for (const item of pending) {
      signal?.throwIfAborted();
      if (loaded?.id !== item.sessionId) loaded = await sessions.get(agentId, item.sessionId);
      const marker = loaded?.messages.find(message => message.id === item.id && message.type === 'compact-marker');
      if (marker && loaded) {
        const input = recallWorkInput(loaded, loaded.messages.indexOf(marker));
        if (input.summary.trim()) await registerCompactWork(dataDir, agentId, input);
      }
    }
    for (const item of changed) progress.sessions[item.id] = stamp(item);
    const live = new Set(metadata.map(item => item.id));
    for (const id of Object.keys(progress.sessions)) if (!live.has(id)) delete progress.sessions[id];
    await writeRecallJson(file, progress);
  });
}
