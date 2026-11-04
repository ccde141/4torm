import path from 'node:path';
import { recallDirectory, recallHash, recallObject, readRecallJson, withRecallLock, writeRecallJson } from './storage.js';
import type { RecallDocument, RecallRecord } from './contracts.js';

interface WorkIndex { version: 1; records: RecallRecord[] }
export interface CompactWorkRecord {
  id: string; sessionId: string; sessionTitle: string; timestamp: string; summary: string; scope?: string;
  sourceRevision?: string;
}
function indexFile(dataDir: string, agentId: string) { return path.join(recallDirectory(dataDir, agentId), 'work-index.json'); }
function documentFile(dataDir: string, agentId: string, id: string) {
  return path.join(recallDirectory(dataDir, agentId), 'work', `${recallHash(id)}.json`);
}
function validRecord(value: unknown): value is RecallRecord {
  return recallObject(value) && value.kind === 'work' && ['id', 'title', 'summary', 'revision', 'agentId', 'timestamp']
    .every(key => typeof value[key] === 'string') && typeof value.date === 'string'
    && Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0;
}
function validIndex(value: unknown): value is WorkIndex {
  return recallObject(value) && value.version === 1 && Array.isArray(value.records) && value.records.every(validRecord);
}
/** Owner calls only after a successful durable compaction. Source IDs make retries idempotent. */
export async function registerCompactWork(dataDir: string, agentId: string, source: CompactWorkRecord): Promise<RecallRecord> {
  if (!source.id || !source.sessionId || !source.summary.trim() || !Number.isFinite(Date.parse(source.timestamp))) {
    throw new Error('WORK_RECORD_INVALID');
  }
  const file = indexFile(dataDir, agentId);
  return withRecallLock(file, async () => {
    const index = await readRecallJson(file, validIndex) ?? { version: 1 as const, records: [] };
    const id = `work:${recallHash(`${source.sessionId}:${source.id}`)}`;
    const previous = index.records.find(record => record.id === id);
    const revision = recallHash(JSON.stringify([source.summary, source.sourceRevision ?? null, source.sessionTitle]));
    if (previous) {
      const updated = { ...previous, title: source.sessionTitle.slice(0, 200), sessionTitle: source.sessionTitle.slice(0, 200),
        revision, summary: source.summary.slice(0, 600), sourceRevision: source.sourceRevision };
      const document = await readWorkRecord(dataDir, agentId, id);
      if (JSON.stringify(previous) !== JSON.stringify(updated)) {
        index.records[index.records.indexOf(previous)] = updated; await writeRecallJson(file, index);
      }
      if (document?.revision !== revision) await writeRecallJson(documentFile(dataDir, agentId, id), { ...updated, content: source.summary });
      return updated;
    }
    const existing = await readWorkRecord(dataDir, agentId, id);
    const date = new Date(source.timestamp);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const record: RecallDocument = existing ?? { id, kind: 'work', agentId, sessionId: source.sessionId,
      sessionTitle: source.sessionTitle.slice(0, 200), sourceId: source.id, title: source.sessionTitle.slice(0, 200), timestamp: source.timestamp,
      date: day, sequence: index.records.reduce((max, item) => item.date === day ? Math.max(max, item.sequence ?? 0) : max, 0) + 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      revision, sourceRevision: source.sourceRevision, summary: source.summary.slice(0, 600), content: source.summary,
      ...(source.scope ? { scope: source.scope } : {}) };
    const { content: _content, ...metadata } = record;
    index.records.push(metadata);
    await writeRecallJson(file, index);
    await writeRecallJson(documentFile(dataDir, agentId, id), record);
    return metadata;
  });
}
export async function listWorkRecords(dataDir: string, agentId: string): Promise<RecallRecord[]> {
  const index = await readRecallJson(indexFile(dataDir, agentId), validIndex);
  return [...(index?.records ?? [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id));
}
export async function readWorkRecord(dataDir: string, agentId: string, id: string): Promise<RecallDocument | null> {
  const result = await readRecallJson(documentFile(dataDir, agentId, id), (value): value is RecallDocument =>
    validRecord(value) && recallObject(value) && typeof value.content === 'string');
  if (result && (result.agentId !== agentId || result.id !== id)) throw new Error('RECALL_OWNER_MISMATCH');
  return result;
}
