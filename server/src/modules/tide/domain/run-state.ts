import { parseTideUsageProgress, type TideUsageProgress } from './token-usage.js';

export const TIDE_RUN_STATUSES = [
  'queued', 'running', 'completed', 'failed', 'aborted', 'crashed',
] as const;

export type TideRunStatus = typeof TIDE_RUN_STATUSES[number];
export type TideRunTrigger = 'manual' | 'schedule';

export interface TideRunState {
  schemaVersion: 1;
  taskId: string;
  runId: string;
  trigger: TideRunTrigger;
  status: TideRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  agentId?: string;
  usage?: TideUsageProgress;
  compactionNotice?: string;
}

export function parseTideRunState(value: unknown): TideRunState {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('invalid schemaVersion');
  const trigger = value.trigger;
  const status = value.status;
  if (trigger !== 'manual' && trigger !== 'schedule') throw new Error('invalid trigger');
  if (!TIDE_RUN_STATUSES.includes(status as TideRunStatus)) throw new Error('invalid status');
  const state: TideRunState = {
    schemaVersion: 1,
    taskId: text(value.taskId, 'taskId'),
    runId: text(value.runId, 'runId'),
    trigger,
    status: status as TideRunStatus,
    createdAt: timestamp(value.createdAt, 'createdAt'),
    updatedAt: timestamp(value.updatedAt, 'updatedAt'),
  };
  copyOptionalTimestamp(state, value, 'startedAt');
  copyOptionalTimestamp(state, value, 'finishedAt');
  copyOptionalText(state, value, 'errorCode');
  copyOptionalText(state, value, 'errorMessage');
  copyOptionalText(state, value, 'agentId');
  copyOptionalText(state, value, 'compactionNotice');
  if (value.usage !== undefined) state.usage = parseTideUsageProgress(value.usage);
  return state;
}

function copyOptionalTimestamp(
  target: TideRunState, source: Record<string, unknown>, key: 'startedAt' | 'finishedAt',
): void {
  if (source[key] !== undefined) target[key] = timestamp(source[key], key);
}

function copyOptionalText(
  target: TideRunState, source: Record<string, unknown>, key: 'errorCode' | 'errorMessage' | 'agentId' | 'compactionNotice',
): void {
  if (source[key] !== undefined) target[key] = text(source[key], key);
}

function timestamp(value: unknown, field: string): string {
  const output = text(value, field);
  if (!Number.isFinite(Date.parse(output))) throw new Error(`${field} must be an ISO timestamp`);
  return output;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be text`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
