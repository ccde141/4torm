import { frameworkError } from '../../../engine/shared/framework-error.js';
import { parseTideInterval } from '../domain/schedule.js';
import { parseTideTask, type TidePushMode, type TideTask } from '../domain/task.js';
import type { TideRunRepository } from '../infrastructure/run-repository.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideScheduler } from '../runtime/scheduler.js';
import {
  deleteTaskSessionDir,
  deleteTideSession,
  listTideSessions,
  readSeasonSession,
  readTideSession,
} from '../sessions/session-store.js';
import { migrateOldTideSessions } from '../sessions/session-migration.js';
import type { TideChangeFeed } from './change-feed.js';

export interface CreateTideTaskInput {
  name: string;
  schedule: string;
  prompt: string;
  agentId: string;
  repeatCount?: number;
  pushMode?: TidePushMode;
  targetSessionId?: string;
  windowN?: number;
  selfLoop?: boolean;
}

export class TideTaskService {
  constructor(
    private readonly dataDir: string,
    private readonly tasks: TideTaskRepository,
    private readonly runs: TideRunRepository,
    private readonly runStates: TideRunStateRepository,
    private readonly scheduler: TideScheduler,
    private readonly changes?: TideChangeFeed,
  ) {}

  async list(): Promise<TideTask[]> {
    return (await this.tasks.read()).tasks;
  }

  async detail(taskId: string) {
    const task = await this.requireTask(taskId);
    const [recent, runState] = await Promise.all([
      this.runs.list(taskId, 5), this.runStates.get(taskId),
    ]);
    return { task, recent, runState };
  }

  async create(input: CreateTideTaskInput, options: { enabled?: boolean } = {}): Promise<TideTask> {
    validateCreate(input);
    const now = new Date();
    const task = parseTideTask({
      id: generateTaskId(), name: input.name, schedule: input.schedule,
      prompt: input.prompt, agentId: input.agentId, repeatCount: input.repeatCount ?? -1,
      pushMode: input.pushMode ?? 'accumulate', targetSessionId: input.targetSessionId,
      windowN: input.windowN ?? 1, roundSeq: 0, archiveBatch: 0,
      selfLoop: input.selfLoop ?? false, consecutiveErrors: 0,
      enabled: options.enabled ?? true,
      createdAt: now.toISOString(),
      ...(options.enabled === false ? {} : {
        nextRun: new Date(now.getTime() + parseTideInterval(input.schedule)).toISOString(),
      }),
    });
    applySelfLoop(task);
    await this.tasks.upsert(task);
    return task;
  }

  async update(taskId: string, patch: Partial<TideTask>, acknowledgeNotice = false): Promise<TideTask> {
    const task = await this.requireTask(taskId);
    validatePatch(patch);
    if (patch.name !== undefined && patch.name !== task.name) {
      await migrateOldTideSessions(this.dataDir, task.agentId, task.id, task.name);
    }
    applyTaskPatch(task, patch);
    parseTideTask(task);
    await this.tasks.upsert(task);
    if (acknowledgeNotice) await this.runStates.acknowledgeCompactionNotice(taskId);
    return task;
  }

  async toggle(taskId: string): Promise<TideTask> {
    const task = await this.requireTask(taskId);
    return this.setEnabled(taskId, !task.enabled);
  }

  async setEnabled(taskId: string, enabled: boolean): Promise<TideTask> {
    const task = await this.requireTask(taskId);
    if (task.enabled === enabled) return task;
    task.enabled = enabled;
    if (enabled) {
      task.nextRun = new Date(Date.now() + parseTideInterval(task.schedule)).toISOString();
    }
    await this.tasks.upsert(task);
    return task;
  }

  async runNow(taskId: string, acknowledgeNotice = false): Promise<string> {
    const runId = await this.scheduler.runNow(taskId, acknowledgeNotice);
    if (!runId) throw taskBusy(taskId);
    return runId;
  }

  async remove(taskId: string): Promise<void> {
    const task = await this.requireTask(taskId);
    const result = await this.scheduler.exclusive(taskId, async () => {
      await deleteTaskSessionDir(this.dataDir, task.agentId, task.id, task.name);
      await this.runs.removeTask(taskId);
      await this.runStates.removeTask(taskId);
      await this.tasks.remove(taskId);
      return true;
    });
    if (result !== true) throw taskBusy(taskId);
  }

  async listRuns(taskId: string, limit: number) {
    await this.requireTask(taskId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw invalidTaskInput('limit 必须是 1 到 100 的整数');
    }
    return this.runs.list(taskId, limit);
  }

  async listSessions(agentId: string) {
    return listTideSessions(this.dataDir, agentId);
  }

  async readSession(agentId: string, sessionId: string) {
    const session = await readTideSession(this.dataDir, agentId, sessionId)
      ?? await readSeasonSession(this.dataDir, agentId, sessionId);
    if (!session) throw sessionNotFound();
    return session;
  }

  async removeSession(taskId: string): Promise<void> {
    const task = await this.requireTask(taskId);
    if (task.enabled) throw invalidTaskState('请先暂停任务再删除会话');
    if (!task.targetSessionId) throw invalidTaskState('该任务没有绑定的会话');
    const deletedSessionId = task.targetSessionId;
    const deleted = await deleteTideSession(
      this.dataDir, task.agentId, deletedSessionId, task.id, task.name,
    );
    if (!deleted) throw sessionNotFound();
    task.targetSessionId = undefined;
    task.roundSeq = 0;
    await this.tasks.upsert(task);
    this.changes?.publish({ scope: 'session', agentId: task.agentId,
      taskId, sessionId: deletedSessionId });
  }

  private async requireTask(taskId: string): Promise<TideTask> {
    const task = await this.tasks.get(taskId);
    if (!task) throw taskNotFound(taskId);
    return task;
  }
}

function validateCreate(input: CreateTideTaskInput): void {
  if (![input.name, input.schedule, input.prompt, input.agentId]
    .every(value => typeof value === 'string' && value.trim().length > 0)) {
    throw invalidTaskInput('缺少 name/schedule/prompt/agentId');
  }
  validateOptionalTypes(input);
  assertIdentifier(input.agentId, 'agentId');
  if (input.targetSessionId) assertIdentifier(input.targetSessionId, 'targetSessionId');
  parseTideInterval(input.schedule);
  validateWindow(input.windowN ?? 1);
  validateRepeatCount(input.repeatCount ?? -1);
  if (input.pushMode === 'designated' && !input.targetSessionId) {
    throw invalidTaskInput('designated 模式需要 targetSessionId');
  }
}

function validatePatch(patch: Partial<TideTask>): void {
  for (const key of ['name', 'prompt', 'schedule'] as const) {
    const value = patch[key];
    if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
      throw invalidTaskInput(`${key} 必须是非空字符串`);
    }
  }
  validateOptionalTypes(patch);
  if (patch.targetSessionId) assertIdentifier(patch.targetSessionId, 'targetSessionId');
}

function assertIdentifier(value: string, field: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidTaskInput(`${field} 无效`);
  }
}

function validateOptionalTypes(input: Partial<TideTask>): void {
  assertOptionalInteger(input.repeatCount, 'repeatCount');
  assertOptionalInteger(input.windowN, 'windowN');
  if (input.pushMode !== undefined
    && input.pushMode !== 'accumulate'
    && input.pushMode !== 'designated') {
    throw invalidTaskInput('pushMode 无效');
  }
  if (input.targetSessionId !== undefined
    && (typeof input.targetSessionId !== 'string' || input.targetSessionId.trim().length === 0)) {
    throw invalidTaskInput('targetSessionId 必须是非空字符串');
  }
  for (const key of ['enabled', 'selfLoop'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw invalidTaskInput(`${key} 必须是布尔值`);
    }
  }
}

function assertOptionalInteger(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value))) {
    throw invalidTaskInput(`${field} 必须是整数`);
  }
}

function applyTaskPatch(task: TideTask, patch: Partial<TideTask>): void {
  const wasDesignated = task.pushMode === 'designated';
  if (patch.name !== undefined) task.name = patch.name;
  if (patch.prompt !== undefined) task.prompt = patch.prompt;
  if (patch.repeatCount !== undefined) task.repeatCount = patch.repeatCount;
  if (patch.enabled !== undefined) task.enabled = patch.enabled;
  if (patch.pushMode !== undefined) task.pushMode = patch.pushMode;
  if (patch.targetSessionId !== undefined) task.targetSessionId = patch.targetSessionId;
  if (patch.windowN !== undefined) task.windowN = patch.windowN;
  if (patch.selfLoop !== undefined) task.selfLoop = patch.selfLoop;
  if (wasDesignated && (task.pushMode === 'accumulate' || task.selfLoop)) {
    task.targetSessionId = undefined;
    task.roundSeq = 0;
  }
  if (patch.schedule !== undefined) {
    parseTideInterval(patch.schedule);
    task.schedule = patch.schedule;
    task.nextRun = new Date(Date.now() + parseTideInterval(task.schedule)).toISOString();
  }
  validateWindow(task.windowN);
  validateRepeatCount(task.repeatCount);
  if (task.pushMode === 'designated' && !task.targetSessionId) {
    throw invalidTaskInput('designated 模式需要 targetSessionId');
  }
  applySelfLoop(task);
}

function applySelfLoop(task: TideTask): void {
  if (!task.selfLoop) return;
  if (task.pushMode === 'designated') task.targetSessionId = undefined;
  task.pushMode = 'accumulate';
  task.windowN = 2;
  task.repeatCount = -1;
  if (!task.originalPrompt) task.originalPrompt = task.prompt;
}

function validateWindow(value: number): void {
  if (!Number.isInteger(value) || value < 1 || (value >= 2 && value % 2 !== 0)) {
    throw invalidTaskInput('windowN 必须为 1 或大于等于 2 的偶数');
  }
}

function validateRepeatCount(value: number): void {
  if (!Number.isInteger(value) || value < -1) {
    throw invalidTaskInput('repeatCount 必须为 -1 或非负整数');
  }
}

function generateTaskId(): string {
  return `tide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function taskNotFound(taskId: string) {
  return frameworkError({
    code: 'TIDE_TASK_NOT_FOUND', kind: 'not_found', message: '潮汐任务不存在',
    source: 'tide.service', retryable: false, details: { taskId },
  });
}

function taskBusy(taskId: string) {
  return frameworkError({
    code: 'TIDE_TASK_RUNNING', kind: 'conflict', message: '潮汐任务正在执行',
    source: 'tide.service', retryable: false, details: { taskId },
  });
}

function invalidTaskInput(message: string) {
  return frameworkError({
    code: 'TIDE_TASK_INPUT_INVALID', kind: 'validation', message,
    source: 'tide.service', retryable: false,
  });
}

function invalidTaskState(message: string) {
  return frameworkError({
    code: 'TIDE_TASK_STATE_INVALID', kind: 'conflict', message,
    source: 'tide.service', retryable: false,
  });
}

function sessionNotFound() {
  return frameworkError({
    code: 'TIDE_SESSION_NOT_FOUND', kind: 'not_found', message: '潮汐会话不存在',
    source: 'tide.service', retryable: false,
  });
}
