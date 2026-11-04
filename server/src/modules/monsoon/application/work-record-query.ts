import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { RecallRecord, RecallSources } from '../../../engine/shared/memory-recall/contracts.js';

export interface WorkRecordListInput {
  agentId: string; query?: string; date?: string; cursor?: string; limit: number;
}
export interface WorkRecordReadInput {
  agentId: string; id: string; revision: string; view: 'record' | 'source'; offset: number; limit: number;
}
export type WorkRecordSummary = Pick<RecallRecord, 'id' | 'title' | 'summary' | 'revision' | 'timestamp'
  | 'date' | 'sequence' | 'timezone' | 'sessionId' | 'sessionTitle' | 'scope'>;

/** The same validated sources serve the human timeline and Agent recall tools. */
export class MonsoonWorkRecordQuery {
  constructor(private readonly sources: RecallSources,
    private readonly exists: (agentId: string) => Promise<boolean> = async () => true) {}

  async list(input: WorkRecordListInput, signal?: AbortSignal) {
    await this.prepare(input.agentId, signal);
    const query = input.query?.trim().toLowerCase() ?? '';
    const identity = JSON.stringify([input.agentId, query, input.date ?? '']);
    const after = decodeCursor(input.cursor, identity);
    const records = (await this.sources.list(input.agentId)).filter(record => record.kind === 'work'
      && record.agentId === input.agentId && (!input.date || record.date === input.date)
      && (!query || `${record.title} ${record.summary} ${record.scope ?? ''}`.toLowerCase().includes(query)))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.id.localeCompare(b.id));
    signal?.throwIfAborted();
    const remaining = after ? records.filter(record => Date.parse(record.timestamp) < Date.parse(after.timestamp)
      || Date.parse(record.timestamp) === Date.parse(after.timestamp) && record.id > after.id) : records;
    const items = remaining.slice(0, input.limit).map(summary);
    const last = items.at(-1);
    return { items, total: records.length, nextCursor: last && remaining.length > items.length
      ? Buffer.from(JSON.stringify({ identity, timestamp: last.timestamp, id: last.id })).toString('base64url') : undefined };
  }

  async read(input: WorkRecordReadInput, signal?: AbortSignal) {
    await this.prepare(input.agentId, signal);
    const document = await this.sources.read(input.agentId, input.id);
    if (!document || document.kind !== 'work' || document.agentId !== input.agentId) throw unavailable();
    if (document.revision !== input.revision) throw changed();
    const fragment = input.view === 'source'
      ? await this.sources.readOriginal?.(input.agentId, input.id, input.offset, input.limit)
      : { content: document.content.slice(input.offset, input.offset + input.limit), total: document.content.length };
    if (!fragment) throw unavailable();
    if (input.offset > fragment.total) throw changed();
    const current = await this.sources.read(input.agentId, input.id);
    signal?.throwIfAborted();
    if (!current || current.revision !== input.revision) throw changed();
    return { record: summary(current), view: input.view, offset: input.offset,
      content: fragment.content, total: fragment.total, hasMore: input.offset + fragment.content.length < fragment.total };
  }

  private async prepare(agentId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!await this.exists(agentId)) throw unavailable();
    await this.sources.sync(agentId, signal);
    signal?.throwIfAborted();
  }
}

function summary(record: RecallRecord): WorkRecordSummary {
  return { id: record.id, title: record.title, summary: record.summary.slice(0, 600), revision: record.revision,
    timestamp: record.timestamp, date: record.date, sequence: record.sequence, timezone: record.timezone,
    sessionId: record.sessionId, sessionTitle: record.sessionTitle, scope: record.scope };
}
function decodeCursor(cursor: string | undefined, identity: string): { timestamp: string; id: string } | undefined {
  if (!cursor) return;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.identity === identity && typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))
      && typeof value.id === 'string' && /^work:[a-f0-9]{64}$/.test(value.id)) return value;
  } catch { /* Rejected below without falling back to a different page. */ }
  throw frameworkError({ code: 'WORK_RECORD_CURSOR_INVALID', kind: 'validation',
    message: '工作记录分页无效，请刷新后重试', source: 'monsoon.work-records', retryable: false });
}
function unavailable() {
  return frameworkError({ code: 'WORK_RECORD_UNAVAILABLE', kind: 'not_found', message: '工作记录来源已不存在',
    source: 'monsoon.work-records', retryable: false });
}
function changed() {
  return frameworkError({ code: 'WORK_RECORD_CHANGED', kind: 'conflict', message: '工作记录已更新，请刷新后重试',
    source: 'monsoon.work-records', retryable: false });
}
