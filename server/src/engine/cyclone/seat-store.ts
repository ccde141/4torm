/**
 * 气旋工位 store —— 工位 CRUD + per-seat 并发锁
 *
 * 只 import shared/ 与本模块自身，零交叉代码。
 * per-seat 锁：自写一份（按 seatId 互斥），不 import 对流的 tryAcquireSessionLock。
 */

import type { SeatData, WorkshopData } from './types';
import { seatFile, seatsDir, readJsonSafe, ensureDir, atomicWrite, removeStrict, genId } from './paths';
import { loadWorkshop, saveWorkshop } from './workshop-store';

/** 在工作室下新增工位（绑定 agent + 角色提示词），更新工作室 meta */
export async function addSeat(
  dataDir: string,
  workshopId: string,
  opts: { agentId: string; title?: string; rolePrompt?: string; duty?: string; overrideAgentRole?: boolean },
): Promise<SeatData> {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) throw new Error(`工作室不存在：${workshopId}`);
  const title = opts.title || '工位';
  // 工位 title 在工作室内唯一（contact 按 title 寻址，复刻信风 label 唯一约束）
  if (await titleExists(dataDir, workshopId, title)) {
    throw new Error(`工位名「${title}」已存在，请换一个（同工作室内工位名不能重复，否则无法 contact 寻址）`);
  }
  const id = genId('seat');
  const now = new Date().toISOString();
  const seat: SeatData = {
    id,
    title,
    rolePrompt: opts.rolePrompt || '',
    duty: opts.duty?.trim() || undefined,
    overrideAgentRole: opts.overrideAgentRole || undefined,
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

/** 检查工作室内是否已有同名工位（可排除指定 seatId 自身，用于改名校验） */
export async function titleExists(
  dataDir: string, workshopId: string, title: string, excludeSeatId?: string,
): Promise<boolean> {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) return false;
  for (const sid of w.seatIds) {
    if (sid === excludeSeatId) continue;
    const seat = await loadSeat(dataDir, workshopId, sid);
    if (seat && seat.title === title) return true;
  }
  return false;
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
  await removeStrict(seatFile(dataDir, workshopId, seatId));
  const w = await loadWorkshop(dataDir, workshopId);
  if (w) {
    w.seatIds = w.seatIds.filter(x => x !== seatId);
    await saveWorkshop(dataDir, w);
  }
}

/** 更新工位角色提示词 / 标题 / 职责 / 覆盖开关（运行中可改，仅更新传入字段） */
export async function updateSeatRole(
  dataDir: string, workshopId: string, seatId: string,
  patch: { title?: string; rolePrompt?: string; duty?: string; overrideAgentRole?: boolean },
): Promise<SeatData | null> {
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) return null;
  if (patch.title !== undefined && patch.title !== seat.title) {
    if (await titleExists(dataDir, workshopId, patch.title, seatId)) {
      throw new Error(`工位名「${patch.title}」已存在，请换一个`);
    }
    seat.title = patch.title;
  }
  if (patch.rolePrompt !== undefined) seat.rolePrompt = patch.rolePrompt;
  if (patch.duty !== undefined) seat.duty = patch.duty.trim() || undefined;
  if (patch.overrideAgentRole !== undefined) seat.overrideAgentRole = patch.overrideAgentRole || undefined;
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
