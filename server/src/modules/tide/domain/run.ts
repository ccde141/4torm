import { parseTideUsageProgress, type TideUsageProgress } from './token-usage.js';

export interface TideRunRecord {
  taskId: string;
  runId?: string;
  timestamp: string;
  status: 'success' | 'error';
  sessionId: string;
  /** Stored at execution time; task settings may change after this run. */
  pushMode?: 'accumulate' | 'designated';
  answer: string;
  rawContent: string;
  toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }>;
  turns: number;
  durationMs: number;
  error?: string;
  usage?: TideUsageProgress;
  notices?: string[];
}

export function parseTideRunRecord(value: unknown): TideRunRecord {
  if (!isRecord(value)) throw new Error('record must be an object');
  const status = value.status;
  if (status !== 'success' && status !== 'error') throw new Error('invalid status');
  if (!Array.isArray(value.toolCalls) || !value.toolCalls.every(isToolCall)) {
    throw new Error('invalid toolCalls');
  }
  const record: TideRunRecord = {
    taskId: stringField(value, 'taskId'),
    timestamp: stringField(value, 'timestamp'),
    status,
    sessionId: stringField(value, 'sessionId'),
    answer: stringField(value, 'answer', true),
    rawContent: stringField(value, 'rawContent', true),
    toolCalls: value.toolCalls,
    turns: nonNegativeInteger(value.turns, 'turns'),
    durationMs: nonNegativeInteger(value.durationMs, 'durationMs'),
  };
  if (value.runId !== undefined) record.runId = stringField(value, 'runId');
  if (value.pushMode !== undefined) {
    if (value.pushMode !== 'accumulate' && value.pushMode !== 'designated') {
      throw new Error('invalid pushMode');
    }
    record.pushMode = value.pushMode;
  }
  if (value.error !== undefined) record.error = stringField(value, 'error', true);
  if (value.usage !== undefined) record.usage = parseTideUsageProgress(value.usage);
  if (value.notices !== undefined) {
    if (!Array.isArray(value.notices) || !value.notices.every(item => typeof item === 'string')) {
      throw new Error('invalid notices');
    }
    record.notices = value.notices;
  }
  return record;
}

function isToolCall(value: unknown): value is TideRunRecord['toolCalls'][number] {
  if (!isRecord(value) || typeof value.tool !== 'string' || typeof value.result !== 'string') return false;
  return isRecord(value.args) && Object.values(value.args).every(item => typeof item === 'string');
}

function stringField(value: Record<string, unknown>, key: string, allowEmpty = false): string {
  const field = value[key];
  if (typeof field === 'string' && (allowEmpty || field.length > 0)) return field;
  throw new Error(`${key} must be a string`);
}

function nonNegativeInteger(value: unknown, key: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new Error(`${key} must be a non-negative integer`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
