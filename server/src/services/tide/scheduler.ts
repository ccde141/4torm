/**
 * 潮汐 — 调度器（Scheduler）
 *
 * 15 秒 tick 周期，遍历 enabled 任务，到期则 fire。
 * Slot 机制：Agent 被锁时写入覆盖式单槽，解锁时 flush。
 */

import { loadTasks, upsertTask, getTask } from './store';
import { parseInterval } from './schedule-parser';
import { runTideTask } from './runner';
import { lockAgent, unlockAgent, registerUnlockHook } from '../../engine/shared/agent-lock';
import type { TideTask } from './types';
import { PendingWorkTracker } from './pending-work';

const TICK_MS = 15_000;

// ── 模块状态 ────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let dataDir = '';
let stopping = false;
const pendingWork = new PendingWorkTracker();

/** 正在执行的 taskId 集合，防止并发重入 */
const runningTasks = new Set<string>();

/** 覆盖式单槽：agentId → 最近一次被锁时的待投递任务 */
const pendingSlots = new Map<string, TideTask>();

/** flush 锁，防止 flush → fire → unlock → flush 递归 */
let flushing = false;

// ── 公开 API ────────────────────────────────────────────────────

export function startScheduler(dir: string): void {
  dataDir = dir;
  if (timer) return;
  stopping = false;
  // 注册解锁钩子：Agent 释放时检查 slot
  registerUnlockHook((agentId) => flushSlot(agentId));
  timer = setInterval(() => {
    pendingWork.track(tick()).catch(console.error);
  }, TICK_MS);
  console.log('[tide] scheduler started, tick every 15s');
}

export function stopScheduler(): void {
  stopping = true;
  if (timer) { clearInterval(timer); timer = null; }
  pendingSlots.clear();
  console.log('[tide] scheduler stopped');
}

export async function drainScheduler(): Promise<void> {
  await pendingWork.drain();
}

/**
 * 由 unlockAgent 收口调用。
 * 检查 agent 是否有待投递的 slot，有则重读磁盘最新版本再 fire。
 */
export async function flushSlot(agentId: string): Promise<void> {
  if (stopping) return;
  if (flushing) return;
  const slotted = pendingSlots.get(agentId);
  pendingSlots.delete(agentId);
  if (!slotted) return;
  // 双重校验：磁盘权威，已删/已停/已耗尽则丢弃
  const fresh = await getTask(dataDir, slotted.id);
  if (!fresh || !fresh.enabled || fresh.repeatCount === 0) return;
  flushing = true;
  try { await fire(fresh); } finally { flushing = false; }
}

/** 手动触发（run-now），绕过 slot 但遵守锁 */
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
    if (runningTasks.has(snap.id)) continue;
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
  if (stopping || runningTasks.has(task.id)) return;
  await pendingWork.track(runTask(task, isManual));
}

async function runTask(task: TideTask, isManual: boolean): Promise<void> {
  runningTasks.add(task.id);

  try {
    await lockAgent(dataDir, task.agentId, 'busy');
  } catch {
    // Agent 被锁 → 写入 slot（覆盖旧的）
    pendingSlots.set(task.agentId, task);
    runningTasks.delete(task.id);
    return;
  }

  try {
    await runTideTask(dataDir, task, isManual);
  } finally {
    runningTasks.delete(task.id);
    // nextRun 由 runner 统一回写（重读磁盘权威版本），此处不再覆盖
    // 解锁（触发 flushSlot 在 agent-lock 侧）
    try { await unlockAgent(dataDir, task.agentId, 'busy'); } catch {}
  }
}
