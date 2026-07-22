/**
 * 潮汐 — 调度器（Scheduler）
 *
 * 15 秒 tick 周期，遍历 enabled 任务，到期则 fire。
 * 同一 taskId 防重入；不同任务之间互不阻塞。
 */

import { loadTasks, upsertTask, getTask } from './store';
import { parseInterval } from './schedule-parser';
import { runTideTask } from './runner';
import type { TideTask } from './types';
import { PendingWorkTracker } from './pending-work';
import { TideTaskRunGate } from './task-run-gate.js';

const TICK_MS = 15_000;

// ── 模块状态 ────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let dataDir = '';
let stopping = false;
const pendingWork = new PendingWorkTracker();
export const tideTaskRuns = new TideTaskRunGate();

// ── 公开 API ────────────────────────────────────────────────────

export function startScheduler(dir: string): void {
  dataDir = dir;
  if (timer) return;
  stopping = false;
  timer = setInterval(() => {
    pendingWork.track(tick()).catch(console.error);
  }, TICK_MS);
  console.log('[tide] scheduler started, tick every 15s');
}

export function stopScheduler(): void {
  stopping = true;
  if (timer) { clearInterval(timer); timer = null; }
  console.log('[tide] scheduler stopped');
}

export async function drainScheduler(): Promise<void> {
  await pendingWork.drain();
}

/** 手动触发（run-now），仍遵守同一任务防重入。 */
export async function fireManual(task: TideTask): Promise<void> {
  await fire(task, true);
}

// ── 内部实现 ────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!dataDir || stopping) return;
  const tasks = await loadTasks(dataDir);
  if (stopping) return;
  const now = Date.now();

  for (const snap of tasks) {
    if (stopping) return;
    if (!snap.enabled) continue;
    if (snap.repeatCount === 0) continue;
    if (tideTaskRuns.has(snap.id)) continue;
    if (!snap.nextRun) {
      // 首次：重读磁盘权威版本再写 nextRun
      const fresh = await getTask(dataDir, snap.id);
      if (!fresh || !fresh.enabled) continue;
      fresh.nextRun = new Date(now + parseInterval(fresh.schedule)).toISOString();
      await upsertTask(dataDir, fresh);
      continue;
    }
    if (new Date(snap.nextRun).getTime() > now) continue;
    // 到期：异步 fire（fire 内部会重读磁盘做最终校验）
    fireById(snap.id).catch(e => console.error(`[tide] fire failed: ${snap.id}`, e));
  }
}

/** 按 id 触发：重读磁盘最新版本，校验后 fire */
async function fireById(taskId: string): Promise<void> {
  if (stopping) return;
  const fresh = await getTask(dataDir, taskId);
  if (!fresh || !fresh.enabled || fresh.repeatCount === 0) return;
  await fire(fresh);
}

async function fire(task: TideTask, isManual = false): Promise<void> {
  if (stopping) return;
  await pendingWork.track(tideTaskRuns.run(task.id, () => runTideTask(dataDir, task, isManual)));
}
