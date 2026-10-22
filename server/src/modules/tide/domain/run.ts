import { parseTideUsageProgress, type TideUsageProgress } from './token-usage.js';

export interface TideRunRecord {
  taskId: string;
  runId?: string;
  timestamp: string;
  status: 'success' | 'error' | 'aborted';
  sessionId: string;
  /** Stored at execution time; task settings may change after this run. */
  pushMode?: 'accumulate' | 'designated';
  /** Execution-time owner, independent of later task configuration changes. */
  agentId?: string;
  /** Whether this run's messages remained in the active session after its save. */
  sessionState?: 'retained' | 'archived';
  answer: string;
  rawContent: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string;
    toolImages?: import('../../../engine/shared/types.js').ToolImageRef[] }>;
  turns: number;
  durationMs: number;
  error?: string;
  usage?: TideUsageProgress;
  notices?: string[];
}

export function parseTideRunRecord(value: unknown): TideRunRecord {
  if (!isRecord(value)) throw new Error('record must be an object');
  const status = value.status;
  if (status !== 'success' && status !== 'error' && status !== 'aborted') throw new Error('invalid status');
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
  if (value.agentId !== undefined) record.agentId = stringField(value, 'agentId');
  if (value.sessionState !== undefined) {
    if (value.sessionState !== 'retained' && value.sessionState !== 'archived') {
      throw new Error('invalid sessionState');
    }
    record.sessionState = value.sessionState;
  }
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
  if (!isRecord(value.args)) return false;
  try {
    return isJsonValue(value.args, new Set());
  } catch {
    return false;
  }
}

/** Persist the original JSON argument types without accepting values JSON would silently discard. */
function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) return false;
  ancestors.add(value);
  try {
    return keys.every(key => {
      if (array && key === 'length') return true;
      if (typeof key !== 'string') return false;
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && 'value' in descriptor
        && isJsonValue(descriptor.value, ancestors);
    });
  } finally {
    ancestors.delete(value);
  }
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
