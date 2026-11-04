import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { MonsoonWorkRecordQuery, WorkRecordListInput, WorkRecordReadInput } from '../application/work-record-query.js';

export function workRecordManifests(): ModuleMethodManifest[] {
  return ['listWorkRecords', 'readWorkRecord'].map(id => ({ id, kind: 'query', permission: 'observe',
    audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } }));
}
export function workRecordHandlers(query: MonsoonWorkRecordQuery): Record<string, ModuleMethodHandler> {
  return {
    listWorkRecords: { parse: parseList, invoke: (context, input) => query.list(input as WorkRecordListInput, context.signal) },
    readWorkRecord: { parse: parseRead, invoke: (context, input) => query.read(input as WorkRecordReadInput, context.signal) },
  };
}
function parseList(value: unknown): WorkRecordListInput {
  const input = record(value, ['agentId', 'query', 'date', 'cursor', 'limit']);
  if (input.date !== undefined && (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
    || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date)) throw invalid();
  return { agentId: owner(input.agentId), query: optionalText(input.query, 200),
    date: input.date as string | undefined, cursor: optionalText(input.cursor, 2048), limit: integer(input.limit, 20, 50) };
}
function parseRead(value: unknown): WorkRecordReadInput {
  const input = record(value, ['agentId', 'id', 'revision', 'view', 'offset', 'limit']);
  if (typeof input.id !== 'string' || !/^work:[a-f0-9]{64}$/.test(input.id)
    || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)
    || input.view !== undefined && !['record', 'source'].includes(String(input.view))) throw invalid();
  return { agentId: owner(input.agentId), id: input.id, revision: input.revision,
    view: input.view as WorkRecordReadInput['view'] ?? 'record',
    offset: integer(input.offset, 0, 10_000_000, 0), limit: integer(input.limit, 6000, 8000) };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function owner(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}
function optionalText(value: unknown, limit: number): string | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > limit) throw invalid();
  return value;
}
function integer(value: unknown, fallback: number, max: number, min = 1): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw invalid();
  return value;
}
function invalid() {
  return frameworkError({ code: 'WORK_RECORD_INPUT_INVALID', kind: 'validation', message: '工作记录查询参数无效',
    source: 'monsoon.work-records', retryable: false });
}
