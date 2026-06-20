/**
 * 气旋工位 store —— 工位 CRUD + per-seat 并发锁
 *
 * 只 import shared/ 与本模块自身，零交叉代码。
 * per-seat 锁：自写一份（按 seatId 互斥），不 import 对流的 tryAcquireSessionLock。
 */

import fs from 'node:fs/promises';
import type { SeatData, WorkshopData } from './types';
import { seatFile, seatsDir, readJsonSafe, ensureDir, atomicWrite, genId } from './paths';
import { loadWorkshop, saveWorkshop } from './workshop-store';

/** 在工作室下新增工位（绑定 agent + 角色提示词），更新工作室 meta */
export async function addSeat(
  dataDir: string,
  workshopId: string,
  opts: { agentId: string; title?: string; rolePrompt?: string },
): Promise<SeatData> {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) throw new Error(`工作室不存在：${workshopId}`);
  const id = genId('seat');
  const now = new Date().toISOString();
  const seat: SeatData = {
    id,
    title: opts.title || '工位',
    rolePrompt: opts.rolePrompt || '',
    agentId: opts.agentId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  await ensureDir(seatsDir(dataDir, workshopId));
  await atomicWrite(seatFile(dataDir, workshopId, id), JSON.stringify(seat, null, 2));
  w.seatIds.push(id);
  await saveWorkshop(dataDir, w);
  return seat;
}

/** 加载工位（不存在返回 null） */
export async function loadSeat(
  dataDir: string, workshopId: string, seatId: string,
): Promise<SeatData | null> {
  return readJsonSafe<SeatData>(seatFile(dataDir, workshopId, seatId));
}

/** 保存工位（刷新 updatedAt） */
export async function saveSeat(
  dataDir: string, workshopId: string, seat: SeatData,
): Promise<void> {
  seat.updatedAt = new Date().toISOString();
  await atomicWrite(seatFile(dataDir, workshopId, seat.id), JSON.stringify(seat, null, 2));
}

/** 删除工位（删文件 + 从工作室 meta 摘除） */
export async function deleteSeat(
  dataDir: string, workshopId: string, seatId: string,
): Promise<void> {
  try { await fs.rm(seatFile(dataDir, workshopId, seatId)); } catch {}
  const w = await loadWorkshop(dataDir, workshopId);
  if (w) {
    w.seatIds = w.seatIds.filter(x => x !== seatId);
    await saveWorkshop(dataDir, w);
  }
}

/** 更新工位角色提示词 / 标题（运行中可改） */
export async function updateSeatRole(
  dataDir: string, workshopId: string, seatId: string,
  patch: { title?: string; rolePrompt?: string },
): Promise<SeatData | null> {
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) return null;
  if (patch.title !== undefined) seat.title = patch.title;
  if (patch.rolePrompt !== undefined) seat.rolePrompt = patch.rolePrompt;
  await saveSeat(dataDir, workshopId, seat);
  return seat;
}

// ── per-seat 并发锁（按 seatId 互斥，非阻塞） ──────────────────
// 自写一份；不复用对流的 tryAcquireSessionLock（零交叉代码）。

const seatLocks = new Set<string>();

/**
 * 尝试获取工位锁。返回 release 函数表示成功；返回 null 表示已被占用。
 * 非阻塞：不排队，直接拒绝——让上层返回 409。
 * 锁键 = workshopId/seatId，保证跨工作室同名 seatId 不互相阻塞。
 */
export function tryAcquireSeatLock(workshopId: string, seatId: string): (() => void) | null {
  const key = `${workshopId}/${seatId}`;
  if (seatLocks.has(key)) return null;
  seatLocks.add(key);
  return () => { seatLocks.delete(key); };
}
