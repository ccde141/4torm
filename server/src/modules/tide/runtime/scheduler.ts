import { frameworkError } from '../../../engine/shared/framework-error.js';
import { parseTideInterval } from '../domain/schedule.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideRunRepository } from '../infrastructure/run-repository.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { PendingWorkTracker } from './pending-work.js';
import type { TideRunRecord } from '../domain/run.js';
import type { TideTask } from '../domain/task.js';
import { runTideTask, type TideRunnerDependencies } from './runner.js';
import { TideTaskRunGate } from './task-run-gate.js';

const TICK_MS = 15_000;

export interface TideSchedulerDependencies {
  dataDir: string;
  tasks: TideTaskRepository;
  runs: TideRunRepository;
  runStates: TideRunStateRepository;
  changes?: TideRunnerDependencies['changes'];
  execute?: TideTaskExecutor;
}

export type TideTaskExecutor = (
  dependencies: TideRunnerDependencies,
  task: TideTask,
  manual: boolean,
  runId: string,
) => Promise<TideRunRecord>;

export class TideScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private readonly pending = new PendingWorkTracker();
  private readonly gate = new TideTaskRunGate();
  private scheduledTrigger: ((taskId: string) => Promise<unknown>) | null = null;

  constructor(private readonly dependencies: TideSchedulerDependencies) {}

  bindScheduledTrigger(trigger: (taskId: string) => Promise<unknown>): void {
    if (this.scheduledTrigger) throw schedulerError('TIDE_TRIGGER_ALREADY_BOUND', '定时触发入口已绑定');
    this.scheduledTrigger = trigger;
  }

  start(): void {
    if (this.timer) return;
    if (!this.scheduledTrigger) throw schedulerError('TIDE_TRIGGER_UNBOUND', '定时触发入口尚未绑定');
    this.stopping = false;
    this.timer = setInterval(() => {
      this.pending.track(this.scanDue()).catch(error => console.error('[tide] tick failed', error));
    }, TICK_MS);
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain(): Promise<void> {
    await this.pending.drain();
  }

  isRunning(taskId: string): boolean {
    return this.gate.has(taskId);
  }

  async runNow(taskId: string, acknowledgeNotice = false): Promise<string | null> {
    const task = await this.dependencies.tasks.get(taskId);
    if (!task) throw taskNotFound(taskId);
    return this.startTask(task.id, true, acknowledgeNotice);
  }

  async runScheduled(taskId: string): Promise<string> {
    const task = await this.dependencies.tasks.get(taskId);
    if (!task) throw taskNotFound(taskId);
    if (!task.enabled || task.repeatCount === 0 || !task.nextRun
      || Date.parse(task.nextRun) > Date.now() || !Number.isFinite(Date.parse(task.nextRun))) {
      throw schedulerError('TIDE_TASK_NOT_DUE', '潮汐任务尚未到定时执行时间');
    }
    const runId = await this.startTask(taskId, false);
    if (!runId) throw schedulerError('TIDE_TASK_BUSY', '潮汐任务正在执行');
    return runId;
  }

  async exclusive<T>(taskId: string, work: () => Promise<T>): Promise<T | undefined> {
    const started = this.gate.start(taskId, work);
    return started.accepted ? started.result : undefined;
  }

  async scanDue(): Promise<void> {
    if (this.stopping) return;
    const trigger = this.scheduledTrigger;
    if (!trigger) throw schedulerError('TIDE_TRIGGER_UNBOUND', '定时触发入口尚未绑定');
    const { tasks } = await this.dependencies.tasks.read();
    for (const task of tasks) {
      if (this.stopping) return;
      if (!task.enabled || task.repeatCount === 0 || this.gate.has(task.id)) continue;
      if (!task.nextRun) await this.scheduleFirstRun(task.id);
      else if (Date.parse(task.nextRun) <= Date.now()) await trigger(task.id);
    }
  }

  private async scheduleFirstRun(taskId: string): Promise<void> {
    const task = await this.dependencies.tasks.get(taskId);
    if (!task?.enabled) return;
    task.nextRun = new Date(Date.now() + parseTideInterval(task.schedule)).toISOString();
    await this.dependencies.tasks.upsert(task);
  }

  private async startTask(taskId: string, manual: boolean, acknowledgeNotice = false): Promise<string | null> {
    const reservation = this.gate.acquire(taskId);
    if (!reservation) return null;
    let runId: string;
    try {
      const task = await this.dependencies.tasks.get(taskId);
      if (!task) throw taskNotFound(taskId);
      runId = (await this.dependencies.runStates.create(
        taskId, manual ? 'manual' : 'schedule', task.agentId, acknowledgeNotice,
      )).runId;
    } catch (error) {
      reservation.release();
      throw error;
    }
    const execution = this.executeReserved(taskId, runId, manual)
      .finally(() => reservation.release());
    this.pending.track(execution).catch(error => console.error(`[tide] run failed: ${taskId}`, error));
    return runId;
  }

  private async executeReserved(taskId: string, runId: string, manual: boolean): Promise<void> {
    try {
      const task = await this.dependencies.tasks.get(taskId);
      if (!task) throw taskNotFound(taskId);
      await this.dependencies.runStates.markRunning(taskId, runId, task.agentId);
      if (!manual && (!task.enabled || task.repeatCount === 0)) {
        await this.dependencies.runStates.finish(taskId, runId, 'aborted');
        return;
      }
      const execute = this.dependencies.execute ?? runTideTask;
      const record = await execute(this.dependencies, task, manual, runId);
      if (record.status === 'success') {
        await this.dependencies.runStates.finish(taskId, runId, 'completed');
      } else {
        await this.dependencies.runStates.finish(taskId, runId, 'failed', {
          code: 'TIDE_RUN_FAILED', message: record.error ?? '潮汐运行失败',
        });
      }
    } catch (error) {
      await this.dependencies.runStates.finish(taskId, runId, 'failed', {
        code: 'TIDE_RUN_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function taskNotFound(taskId: string) {
  return frameworkError({
    code: 'TIDE_TASK_NOT_FOUND', kind: 'not_found',
    message: '潮汐任务不存在', source: 'tide.scheduler', retryable: false,
    details: { taskId },
  });
}

function schedulerError(code: string, message: string) {
  return frameworkError({ code, kind: 'conflict', message,
    source: 'tide.scheduler', retryable: false });
}
