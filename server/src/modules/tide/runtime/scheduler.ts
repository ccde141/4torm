import { frameworkError } from '../../../engine/shared/framework-error.js';
import { nextTideRun, parseTideSchedule } from '../domain/schedule.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideRunRepository } from '../infrastructure/run-repository.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { PendingWorkTracker } from './pending-work.js';
import type { TideRunRecord } from '../domain/run.js';
import type { TideTask } from '../domain/task.js';
import { recordAbortedTideRun, runTideTask, type TideRunnerDependencies } from './runner.js';
import { TideTaskRunGate } from './task-run-gate.js';
import { isTideRunAborted, TideRunControl, type TideRunAbortReceipt } from './run-control.js';

const TICK_MS = 1_000;
const DAILY_DUE_WINDOW_MS = 60_000;

export interface TideSchedulerDependencies {
  dataDir: string;
  tasks: TideTaskRepository;
  runs: TideRunRepository;
  runStates: TideRunStateRepository;
  changes?: TideRunnerDependencies['changes'];
  seasonSessions?: TideRunnerDependencies['seasonSessions'];
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
  private activeSince = Date.now();
  private timeZone = localTimeZone();
  private scanning: Promise<void> | null = null;
  private readonly missedDailyRuns = new Map<string, { schedule: string; nextRun: string }>();
  private readonly pending = new PendingWorkTracker();
  private readonly gate = new TideTaskRunGate();
  private readonly activeRuns = new Map<string, TideRunControl>();
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
    this.activeSince = Date.now();
    this.timeZone = localTimeZone();
    this.scanInBackground();
    this.timer = setInterval(() => {
      this.scanInBackground();
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
    if (!isDue(task, Date.now(), this.activeSince)) {
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

  async abortRun(taskId: string, runId: string): Promise<TideRunAbortReceipt> {
    const state = await this.dependencies.runStates.getRun(taskId, runId);
    if (!state) throw frameworkError({ code: 'TIDE_RUN_NOT_FOUND', kind: 'not_found',
      message: '潮汐执行不存在', source: 'tide.scheduler', retryable: false });
    if (state.status !== 'queued' && state.status !== 'running') {
      return { taskId, runId, accepted: false, status: state.status };
    }
    const control = this.activeRuns.get(taskId);
    if (!control || control.runId !== runId) {
      throw schedulerError('TIDE_RUN_NOT_ACTIVE', '该执行不是当前可中止的潮汐执行');
    }
    return control.abort();
  }

  async scanDue(): Promise<void> {
    if (this.stopping) return;
    if (this.scanning) return this.scanning;
    const scan = this.scanTasks();
    this.scanning = scan;
    try {
      await scan;
    } finally {
      if (this.scanning === scan) this.scanning = null;
    }
  }

  private scanInBackground(): void {
    if (this.stopping || this.scanning) return;
    this.pending.track(this.scanDue()).catch(error => console.error('[tide] tick failed', error));
  }

  private async scanTasks(): Promise<void> {
    const trigger = this.scheduledTrigger;
    if (!trigger) throw schedulerError('TIDE_TRIGGER_UNBOUND', '定时触发入口尚未绑定');
    const zone = localTimeZone();
    const zoneChanged = zone !== this.timeZone;
    const { tasks } = await this.dependencies.tasks.read();
    const taskIds = new Set(tasks.map(task => task.id));
    for (const taskId of this.missedDailyRuns.keys()) {
      if (!taskIds.has(taskId)) this.missedDailyRuns.delete(taskId);
    }
    for (const task of tasks) {
      if (this.stopping) return;
      if (!task.enabled || task.repeatCount === 0) {
        this.missedDailyRuns.delete(task.id);
        continue;
      }
      const now = Date.now();
      if (this.gate.has(task.id)) {
        if (parseTideSchedule(task.schedule).kind === 'daily' && task.nextRun
          && Date.parse(task.nextRun) <= now) {
          this.missedDailyRuns.set(task.id, { schedule: task.schedule, nextRun: task.nextRun });
        }
        continue;
      }
      const missed = this.missedDailyRuns.get(task.id);
      this.missedDailyRuns.delete(task.id);
      if ((missed?.schedule === task.schedule && missed.nextRun === task.nextRun)
        || needsDailyReschedule(task, now, this.activeSince, zoneChanged)) {
        await this.reschedule(task, now);
      } else if (!task.nextRun) {
        await this.reschedule(task, now);
      } else if (Date.parse(task.nextRun) <= now) {
        await trigger(task.id);
      }
    }
    this.timeZone = zone;
  }

  private reschedule(task: TideTask, now: number): Promise<boolean> {
    return this.dependencies.tasks.reschedule(task.id,
      { schedule: task.schedule, nextRun: task.nextRun }, nextTideRun(task.schedule, now));
  }

  private async startTask(taskId: string, manual: boolean, acknowledgeNotice = false): Promise<string | null> {
    const reservation = this.gate.acquire(taskId);
    if (!reservation) return null;
    let runId: string;
    try {
      const task = await this.dependencies.tasks.get(taskId);
      if (!task) throw taskNotFound(taskId);
      if (!manual && (this.stopping || !isDue(task, Date.now(), this.activeSince))) {
        throw schedulerError('TIDE_TASK_NOT_DUE', '潮汐任务尚未到定时执行时间');
      }
      runId = (await this.dependencies.runStates.create(
        taskId, manual ? 'manual' : 'schedule', task.agentId, acknowledgeNotice,
      )).runId;
      if (!manual && parseTideSchedule(task.schedule).kind === 'daily') {
        let consumed: boolean;
        try {
          consumed = await this.reschedule(task, Math.max(Date.now(), Date.parse(task.nextRun!)));
        } catch (error) {
          await this.dependencies.runStates.finish(taskId, runId, 'failed', {
            code: 'TIDE_SCHEDULE_ADVANCE_FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        if (!consumed) {
          await this.dependencies.runStates.finish(taskId, runId, 'aborted');
          throw schedulerError('TIDE_TASK_PLAN_CHANGED', '潮汐计划已变更，本次触发已取消');
        }
      }
    } catch (error) {
      reservation.release();
      throw error;
    }
    const control = new TideRunControl(taskId, runId);
    this.activeRuns.set(taskId, control);
    const execution = this.executeReserved(taskId, runId, manual, control)
      .finally(() => {
        if (this.activeRuns.get(taskId) === control) this.activeRuns.delete(taskId);
        reservation.release();
      });
    this.pending.track(execution).catch(error => console.error(`[tide] run failed: ${taskId}`, error));
    return runId;
  }

  private async executeReserved(taskId: string, runId: string, manual: boolean,
    control: TideRunControl): Promise<void> {
    let executingTask: TideTask | null = null;
    try {
      const task = await this.dependencies.tasks.get(taskId);
      if (!task) throw taskNotFound(taskId);
      executingTask = task;
      await this.dependencies.runStates.markRunning(taskId, runId, task.agentId);
      control.signal.throwIfAborted();
      if (!manual && (this.stopping || !task.enabled || task.repeatCount === 0)) {
        await this.dependencies.runStates.finish(taskId, runId, 'aborted');
        return;
      }
      const execute = this.dependencies.execute ?? runTideTask;
      const record = await execute({ ...this.dependencies, runControl: control }, task, manual, runId);
      if (record.status === 'success') {
        await this.dependencies.runStates.finish(taskId, runId, 'completed');
      } else if (record.status === 'aborted') {
        await this.dependencies.runStates.finish(taskId, runId, 'aborted');
      } else {
        await this.dependencies.runStates.finish(taskId, runId, 'failed', {
          code: 'TIDE_RUN_FAILED', message: record.error ?? '潮汐运行失败',
        });
      }
    } catch (error) {
      let failure = error;
      if (isTideRunAborted(error) && executingTask) {
        try {
          await recordAbortedTideRun({ ...this.dependencies, runControl: control }, executingTask, runId);
          await this.dependencies.runStates.finish(taskId, runId, 'aborted');
          return;
        } catch (persistError) { failure = persistError; }
      }
      await this.dependencies.runStates.finish(taskId, runId, 'failed', {
        code: 'TIDE_RUN_EXECUTION_FAILED',
        message: failure instanceof Error ? failure.message : String(failure),
      });
      throw failure;
    }
  }
}

function isDue(task: TideTask, now: number, activeSince: number): boolean {
  if (!task.enabled || task.repeatCount === 0 || !task.nextRun) return false;
  const due = Date.parse(task.nextRun);
  if (!Number.isFinite(due) || due > now) return false;
  return parseTideSchedule(task.schedule).kind === 'interval'
    || (due > activeSince && now - due < DAILY_DUE_WINDOW_MS);
}

function needsDailyReschedule(task: TideTask, now: number, activeSince: number, zoneChanged: boolean): boolean {
  const schedule = parseTideSchedule(task.schedule);
  if (schedule.kind !== 'daily') return false;
  if (!task.nextRun || zoneChanged) return true;
  const due = new Date(task.nextRun);
  return !Number.isFinite(due.getTime()) || due.getTime() <= activeSince
    || now - due.getTime() >= DAILY_DUE_WINDOW_MS
    || due.getHours() !== schedule.hour || due.getMinutes() !== schedule.minute;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
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
