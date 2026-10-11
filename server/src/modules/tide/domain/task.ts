import { frameworkError } from '../../../engine/shared/framework-error.js';
import { parseTideInterval } from './schedule.js';

export type TidePushMode = 'accumulate' | 'designated';

export interface TideTask {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  agentId: string;
  repeatCount: number;
  pushMode: TidePushMode;
  targetSessionId?: string;
  windowN: number;
  roundSeq?: number;
  archiveBatch?: number;
  selfLoop: boolean;
  originalPrompt?: string;
  consecutiveErrors: number;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
}

export function parseTideTask(value: unknown, index?: number): TideTask {
  if (!isRecord(value)) throw invalidTask(index, '任务必须是对象');
  const task: TideTask = {
    id: requiredString(value.id, 'id', index),
    name: requiredString(value.name, 'name', index),
    schedule: requiredString(value.schedule, 'schedule', index),
    prompt: requiredString(value.prompt, 'prompt', index),
    agentId: requiredString(value.agentId, 'agentId', index),
    repeatCount: integer(value.repeatCount, 'repeatCount', index),
    pushMode: pushMode(value.pushMode, index),
    windowN: optionalInteger(value.windowN, 1, 'windowN', index),
    selfLoop: optionalBoolean(value.selfLoop, false, 'selfLoop', index),
    consecutiveErrors: optionalInteger(value.consecutiveErrors, 0, 'consecutiveErrors', index),
    enabled: optionalBoolean(value.enabled, false, 'enabled', index),
    createdAt: requiredString(value.createdAt, 'createdAt', index),
  };
  parseTideInterval(task.schedule);
  copyOptionalStrings(task, value, index);
  copyOptionalIntegers(task, value, index);
  validateRanges(task, index);
  return task;
}

export function parseTideTaskList(value: unknown): TideTask[] {
  if (!Array.isArray(value)) throw invalidTask(undefined, '任务文件必须是数组');
  return value.map((item, index) => parseTideTask(item, index));
}

function copyOptionalStrings(task: TideTask, value: Record<string, unknown>, index?: number): void {
  for (const key of ['targetSessionId', 'originalPrompt', 'lastRun', 'nextRun'] as const) {
    const candidate = value[key];
    if (candidate !== undefined) task[key] = requiredString(candidate, key, index);
  }
}

function copyOptionalIntegers(task: TideTask, value: Record<string, unknown>, index?: number): void {
  for (const key of ['roundSeq', 'archiveBatch'] as const) {
    const candidate = value[key];
    if (candidate !== undefined) task[key] = integer(candidate, key, index);
  }
}

function validateRanges(task: TideTask, index?: number): void {
  if (task.repeatCount < -1) throw invalidTask(index, 'repeatCount 必须为 -1 或非负整数');
  if (task.windowN < 1 || (task.windowN > 1 && task.windowN % 2 !== 0)) {
    throw invalidTask(index, 'windowN 必须为 1 或大于等于 2 的偶数');
  }
  if (task.consecutiveErrors < 0) throw invalidTask(index, 'consecutiveErrors 不能为负数');
  if ((task.roundSeq ?? 0) < 0) throw invalidTask(index, 'roundSeq 不能为负数');
  if ((task.archiveBatch ?? 0) < 0) throw invalidTask(index, 'archiveBatch 不能为负数');
  if (task.pushMode === 'designated' && !task.targetSessionId) {
    throw invalidTask(index, 'designated 模式需要 targetSessionId');
  }
}

function requiredString(value: unknown, field: string, index?: number): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw invalidTask(index, `${field} 必须是非空字符串`);
}

function integer(value: unknown, field: string, index?: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw invalidTask(index, `${field} 必须是整数`);
}

function optionalInteger(value: unknown, fallback: number, field: string, index?: number): number {
  return value === undefined ? fallback : integer(value, field, index);
}

function optionalBoolean(value: unknown, fallback: boolean, field: string, index?: number): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  throw invalidTask(index, `${field} 必须是布尔值`);
}

function pushMode(value: unknown, index?: number): TidePushMode {
  if (value === undefined || value === 'accumulate') return 'accumulate';
  if (value === 'designated') return value;
  throw invalidTask(index, 'pushMode 无效');
}

function invalidTask(index: number | undefined, reason: string) {
  return frameworkError({
    code: 'TIDE_TASKS_INVALID', kind: 'protocol',
    message: index === undefined ? `潮汐任务数据无效：${reason}` : `潮汐任务 ${index} 无效：${reason}`,
    source: 'tide.task', retryable: false,
    details: index === undefined ? undefined : { index },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
