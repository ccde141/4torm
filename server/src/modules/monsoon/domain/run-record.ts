import type { ProbeStatus } from '../../../shared/probes/public.js';

export interface MonsoonRunRecord {
  schemaVersion: 1;
  sessionId: string;
  runId: string;
  agentId: string;
  status: ProbeStatus;
  phase: string;
  updatedAt: string;
  createdAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

const fields = new Set([
  'schemaVersion', 'sessionId', 'runId', 'agentId', 'status', 'phase', 'updatedAt',
  'errorCode', 'errorMessage',
  'createdAt',
]);
const statuses = new Set<ProbeStatus>([
  'idle', 'queued', 'running', 'waiting', 'completed', 'aborted', 'failed', 'crashed',
]);

export function parseMonsoonRunRecord(value: unknown): MonsoonRunRecord {
  if (!isRecord(value) || Object.keys(value).some(key => !fields.has(key))) {
    throw new Error('run record has unknown fields');
  }
  if (value.schemaVersion !== 1 || !statuses.has(value.status as ProbeStatus)) {
    throw new Error('run record version or status is invalid');
  }
  const record: MonsoonRunRecord = {
    schemaVersion: 1,
    sessionId: text(value.sessionId, 'sessionId', 160),
    runId: text(value.runId, 'runId', 160),
    agentId: text(value.agentId, 'agentId', 160),
    status: value.status as ProbeStatus,
    phase: text(value.phase, 'phase', 160),
    updatedAt: timestamp(value.updatedAt),
  };
  if (value.errorCode !== undefined) record.errorCode = text(value.errorCode, 'errorCode', 160);
  if (value.createdAt !== undefined) record.createdAt = timestamp(value.createdAt);
  if (value.errorMessage !== undefined) record.errorMessage = text(value.errorMessage, 'errorMessage', 2_000);
  return record;
}

export function crashRun(record: MonsoonRunRecord, updatedAt: string): MonsoonRunRecord {
  if (!['queued', 'running', 'waiting'].includes(record.status)) return record;
  return { ...record, createdAt: record.createdAt ?? record.updatedAt,
    status: 'crashed', phase: 'crashed', updatedAt,
    errorCode: 'MONSOON_PROCESS_RESTARTED', errorMessage: '上次执行随进程结束，无法继续' };
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function timestamp(value: unknown): string {
  const result = text(value, 'updatedAt', 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error('updatedAt is invalid');
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
