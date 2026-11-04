import { invokeFeature } from './collaboration';

export interface WorkRecord {
  id: string; title: string; summary: string; revision: string; timestamp: string;
  date?: string; sequence?: number; timezone?: string; sessionId?: string; sessionTitle?: string; scope?: string;
}
export interface WorkRecordPage { items: WorkRecord[]; total: number; nextCursor?: string }
export interface WorkRecordFragment {
  record: WorkRecord; view: 'record' | 'source'; offset: number; content: string; total: number; hasMore: boolean;
}
export function listWorkRecords(agentId: string, input: { query?: string; date?: string; cursor?: string } = {}, signal?: AbortSignal) {
  return invokeFeature<WorkRecordPage>('monsoon', 'listWorkRecords', { agentId, ...input, limit: 20 }, undefined, { signal });
}
export function readWorkRecord(agentId: string, record: WorkRecord,
  input: { view: 'record' | 'source'; offset: number }, signal?: AbortSignal) {
  return invokeFeature<WorkRecordFragment>('monsoon', 'readWorkRecord',
    { agentId, id: record.id, revision: record.revision, ...input, limit: 6000 }, undefined, { signal });
}
