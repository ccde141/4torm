import fs from 'node:fs/promises';
import path from 'node:path';
import { listMemory, readMemory, memoryTier } from '../agent-memory.js';
import { agentMemoryDir } from '../../../services/data-paths.js';
import { listWorkRecords, readWorkRecord } from './work-records.js';
import { recallHash } from './storage.js';
import type { RecallDocument, RecallRecord, RecallSources } from './contracts.js';

async function version(dataDir: string, agentId: string, slug: string) {
  if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) throw new Error('RECALL_SOURCE_INVALID');
  try {
    const stat = await fs.stat(path.join(agentMemoryDir(dataDir, agentId), `${slug}.md`));
    return { revision: recallHash(`${stat.mtimeMs}:${stat.size}`), timestamp: stat.mtime.toISOString() };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Candidate scans read indexes and versions. Full text is opened only for selected sources. */
export function createRecallCatalog(dataDir: string, sync: RecallSources['sync'] = async () => {}): RecallSources {
  return { sync, list: async agentId => {
    const memories = await listMemory(dataDir, agentId);
    const entries: RecallRecord[] = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(16, memories.length) }, async () => {
      while (cursor < memories.length) {
        const row = memories[cursor++], current = await version(dataDir, agentId, row.slug);
        if (current) entries.push({ id: `memory:${row.slug}`, kind: 'memory', agentId, title: row.summary.slice(0, 200),
          summary: `${row.tags.join(' ')} ${row.summary}`.slice(0, 600), category: row.category,
          archived: memoryTier(row) === 'archived', ...current });
      }
    }));
    return [...entries, ...await listWorkRecords(dataDir, agentId)];
  }, read: async (agentId, id): Promise<RecallDocument | null> => {
    if (id.startsWith('work:')) return readWorkRecord(dataDir, agentId, id);
    if (!id.startsWith('memory:')) return null;
    const before = await version(dataDir, agentId, id.slice(7));
    const entry = before ? await readMemory(dataDir, agentId, id.slice(7)) : null;
    const current = await version(dataDir, agentId, id.slice(7));
    if (before?.revision !== current?.revision) throw new Error('RECALL_SOURCE_CHANGED');
    return entry && current ? { id, kind: 'memory', agentId, title: entry.summary.slice(0, 200), summary: entry.summary.slice(0, 600),
      ...current, scope: entry.scope, category: entry.category, archived: memoryTier(entry) === 'archived',
      updated: entry.updated, slug: entry.slug, sessionId: entry.originSession, content: entry.detail } : null;
  } };
}
