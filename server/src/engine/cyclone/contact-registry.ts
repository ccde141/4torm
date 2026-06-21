/**
 * 气旋 Contact 注册表 —— 工位间横向联络的寻址 + 死锁防护
 *
 * 算法层忠实复刻信风 contact-registry（经强压测）：waitGraph 环检测、寻址索引。
 * 与信风的唯一差异：
 * - 信风全局单例（一进程一工作流）；气旋多工作室并发，按 workshopId 隔离 waitGraph。
 * - 信风 label→nodeId→内存 runner；气旋 title→seatId（runner 不常驻，由执行器按需加载会话）。
 *
 * 只 import 本目录模块，零交叉代码。
 */

import { loadWorkshop } from './workshop-store';
import { loadSeat } from './seat-store';
import { DEFAULT_DUTY } from './types';

/** 一个可联络目标：工位名 + 职责名片（供发起方判断该不该联络它） */
export interface ContactTarget { title: string; duty: string; }

// ── 寻址 ─────────────────────────────────────────────────────────

/**
 * 在工作室内按 title 找工位 seatId。
 * title 在工作室内唯一（addSeat/updateSeatRole 时校验），找不到返回 null。
 */
export async function findSeatIdByTitle(
  dataDir: string, workshopId: string, title: string,
): Promise<string | null> {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) return null;
  for (const sid of w.seatIds) {
    const seat = await loadSeat(dataDir, workshopId, sid);
    if (seat && seat.title === title) return sid;
  }
  return null;
}

/** 列出工作室内其他工位（去掉指定 seatId 自身），带职责名片，用于热注入 contact 名单 */
export async function listOtherSeats(
  dataDir: string, workshopId: string, selfSeatId: string,
): Promise<ContactTarget[]> {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) return [];
  const out: ContactTarget[] = [];
  for (const sid of w.seatIds) {
    if (sid === selfSeatId) continue;
    const seat = await loadSeat(dataDir, workshopId, sid);
    if (seat) out.push({ title: seat.title, duty: seat.duty?.trim() || DEFAULT_DUTY });
  }
  return out;
}

// ── 等待图 + 环检测（按 workshopId 隔离） ─────────────────────────

/** workshopId → (sourceSeatId → targetSeatId)，source 正在等 target 回复 */
const waitGraphs = new Map<string, Map<string, string>>();

function graphOf(workshopId: string): Map<string, string> {
  let g = waitGraphs.get(workshopId);
  if (!g) { g = new Map(); waitGraphs.set(workshopId, g); }
  return g;
}

/**
 * 尝试注册等待关系：source 即将等 target 回复。
 * 若注册后会成环（死锁）返回 false 不注册；成功返回 true。
 */
export function tryRegisterWait(workshopId: string, sourceSeatId: string, targetSeatId: string): boolean {
  if (wouldFormCycle(workshopId, sourceSeatId, targetSeatId)) return false;
  graphOf(workshopId).set(sourceSeatId, targetSeatId);
  return true;
}

/** contact 完成后清除等待关系 */
export function clearWait(workshopId: string, sourceSeatId: string): void {
  const g = waitGraphs.get(workshopId);
  if (g) { g.delete(sourceSeatId); if (g.size === 0) waitGraphs.delete(workshopId); }
}

/**
 * 环检测：从 target 沿现有等待边 DFS，能否走回 source。
 * 能走回 → 加入 source→target 会成环 → 返回 true。
 */
function wouldFormCycle(workshopId: string, sourceSeatId: string, targetSeatId: string): boolean {
  const g = waitGraphs.get(workshopId);
  if (!g) return false;
  let current: string | undefined = targetSeatId;
  const visited = new Set<string>();
  while (current) {
    if (current === sourceSeatId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = g.get(current);
  }
  return false;
}
