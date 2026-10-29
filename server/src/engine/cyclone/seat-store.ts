/**
 * 气旋工位 store —— 工位 CRUD + per-seat 并发锁
 *
 * per-seat 锁按 seatId 互斥，独立于对流的 tryAcquireSessionLock。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ContextMessage, SeatContextMessage, SeatData, WorkshopData } from './types';
import { seatFile, seatsDir, readJsonSafe, ensureDir, atomicWrite, genId, cycloneArchiveFile, workshopBakDir } from './paths';
import { loadWorkshop, saveWorkshop } from './workshop-store';
import { frameworkError } from '../shared/framework-error.js';
import { appendSeatConfigurationHistory, parseSeatHistory, type SeatHistorySource } from './seat-history.js';
import { captureCycloneCompaction } from './conversation-transcript.js';

/** 在工作室下新增工位（绑定 agent + 角色提示词），更新工作室 meta */
async function addSeatUnlocked(
  dataDir: string,
  workshopId: string,
  opts: { agentId: string; title?: string; rolePrompt?: string; duty?: string; overrideAgentRole?: boolean },
): Promise<SeatData> {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) throw new Error(`工作室不存在：${workshopId}`);
  const title = opts.title || '工位';
  // 工位 title 在工作室内唯一，供 contact 按 title 寻址。
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

export async function addSeat(
  dataDir: string, workshopId: string,
  opts: { agentId: string; title?: string; rolePrompt?: string; duty?: string; overrideAgentRole?: boolean },
): Promise<SeatData> {
  return withWorkshopSeatMutation(dataDir, workshopId, () => addSeatUnlocked(dataDir, workshopId, opts));
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
  const seat = await readJsonSafe<SeatData>(seatFile(dataDir, workshopId, seatId));
  if (seat?.history !== undefined) parseSeatHistory(seat.history, workshopId, seatId, 'configuration');
  return seat;
}

/** 保存工位（刷新 updatedAt） */
export async function saveSeat(
  dataDir: string, workshopId: string, seat: SeatData, signal?: AbortSignal,
): Promise<void> {
  const retiredFile = path.join(workshopBakDir(dataDir, workshopId), 'retired-seats', seat.id, `${seat.id}.json`);
  let retired = false;
  try { await fs.access(retiredFile); retired = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (retired && !(await loadWorkshop(dataDir, workshopId))?.seatIds.includes(seat.id)) throw frameworkError({
    code: 'CYCLONE_SEAT_RETIRED', kind: 'conflict',
    message: '工位已移除，不能写回旧执行内容', source: 'cyclone.seats', retryable: false });
  seat.updatedAt = new Date().toISOString();
  await atomicWrite(seatFile(dataDir, workshopId, seat.id), JSON.stringify(seat, null, 2), signal);
}

function archiveName(scope: string, id: string, seq: number): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-${scope}-${id}-${seq}.json`;
}

/** 归档并重置工位私聊上下文 */
export async function resetSeatContext(
  dataDir: string,
  workshopId: string,
  seatId: string,
  opts: { summary?: string; retainedMessages?: SeatContextMessage[]; forcePending?: boolean; preparedArchivePath?: string; signal?: AbortSignal;
    compaction?: import('../shared/compaction/index.js').CompactionProgress } = {},
): Promise<{ seat: SeatData | null; archivePath?: string; archivedCount?: number }> {
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) return { seat: null };
  if (seat.pending && !opts.forcePending) throw new Error('该工位存在挂起提问，请先回答或使用强制重置');
  if (opts.summary && opts.retainedMessages === undefined) throw new Error('工位压缩缺少原文保留计划');

  const state = seat.compactState || { disabled: false, archiveSeq: 0 };
  const nextSeq = (state.archiveSeq || 0) + 1;
  const originalMessages = seat.messages || [];
  const archivePath = opts.preparedArchivePath || cycloneArchiveFile(dataDir, workshopId, archiveName('seat', seatId, nextSeq));
  if (!opts.preparedArchivePath) await ensureDir(archivePath.replace(/[\\/][^\\/]+$/, ''));
  if (!opts.preparedArchivePath) await atomicWrite(archivePath, JSON.stringify({
    type: 'cyclone-seat-context-reset',
    version: 1,
    createdAt: new Date().toISOString(),
    workshopId,
    seatId,
    seatTitle: seat.title,
    mode: opts.summary ? 'summary' : 'clear',
    messages: originalMessages,
    pending: seat.pending || null,
    tokenUsage: seat.tokenUsage || null,
    compactState: seat.compactState || null,
  }, null, 2));

  seat.messages = opts.summary
    ? [{ role: 'system', content: `以下是重置前的工位私聊摘要，请作为后续上下文参考：\n\n${opts.summary}` },
      ...opts.retainedMessages!]
    : [];
  seat.displayHistory = opts.summary ? captureCycloneCompaction(seat.displayHistory, originalMessages, seat.messages,
    { role: 'system', content: `[历史压缩记录]\n${opts.summary}`, compactionId: opts.compaction?.id }) : undefined;
  seat.pending = undefined;
  seat.tokenUsage = undefined;
  seat.compactState = { ...state, archiveSeq: nextSeq, lastCompactAt: new Date().toISOString() };
  if (opts.compaction) seat.compaction = opts.compaction;
  await saveSeat(dataDir, workshopId, seat, opts.signal);
  return { seat, archivePath, archivedCount: originalMessages.length };
}

/** 退出活动结构前保存完整岗位快照；历史附件不因移除工位而销毁。 */
async function deleteSeatUnlocked(
  dataDir: string, workshopId: string, seatId: string,
): Promise<void> {
  if (![workshopId, seatId].every(value => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value))) {
    throw new Error('工位标识无效');
  }
  const directory = seatsDir(dataDir, workshopId);
  const retired = path.join(workshopBakDir(dataDir, workshopId), 'retired-seats', seatId);
  let names: string[];
  try { names = await fs.readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; names = []; }
  const files = names.filter(name => name === `${seatId}.json` || name.startsWith(`${seatId}.`));
  if (files.length) {
    await ensureDir(retired);
    // Original files remain available until every sidecar has a recoverable copy.
    await Promise.all(files.map(name => fs.cp(path.join(directory, name), path.join(retired, name),
      { recursive: true, force: true })));
  }
  const w = await loadWorkshop(dataDir, workshopId);
  if (w) {
    w.seatIds = w.seatIds.filter(x => x !== seatId);
    await saveWorkshop(dataDir, w);
  }
  try { await fs.rename(seatFile(dataDir, workshopId, seatId), path.join(retired, `${seatId}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export async function deleteSeat(dataDir: string, workshopId: string, seatId: string): Promise<void> {
  return withWorkshopSeatMutation(dataDir, workshopId, () => deleteSeatUnlocked(dataDir, workshopId, seatId));
}

/** 更新工位绑定 / 角色提示词 / 标题 / 职责 / 覆盖开关（仅更新传入字段） */
async function updateSeatRoleUnlocked(
  dataDir: string, workshopId: string, seatId: string,
  patch: { agentId?: string; title?: string; rolePrompt?: string; duty?: string; overrideAgentRole?: boolean },
  source: SeatHistorySource = 'unknown',
): Promise<SeatData | null> {
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) return null;
  const previous = { ...seat };
  if (patch.agentId !== undefined) {
    const agentId = patch.agentId.trim();
    if (!agentId) throw new Error('绑定 Agent 不能为空');
    seat.agentId = agentId;
  }
  if (patch.title !== undefined && patch.title !== seat.title) {
    if (await titleExists(dataDir, workshopId, patch.title, seatId)) {
      throw new Error(`工位名「${patch.title}」已存在，请换一个`);
    }
    seat.title = patch.title;
  }
  if (patch.rolePrompt !== undefined) seat.rolePrompt = patch.rolePrompt;
  if (patch.duty !== undefined) seat.duty = patch.duty.trim() || undefined;
  if (patch.overrideAgentRole !== undefined) seat.overrideAgentRole = patch.overrideAgentRole || undefined;
  appendSeatConfigurationHistory(workshopId, previous, seat, source);
  await saveSeat(dataDir, workshopId, seat);
  return seat;
}

export async function updateSeatRole(
  dataDir: string, workshopId: string, seatId: string,
  patch: { agentId?: string; title?: string; rolePrompt?: string; duty?: string; overrideAgentRole?: boolean },
  source: SeatHistorySource = 'unknown',
): Promise<SeatData | null> {
  return withWorkshopSeatMutation(dataDir, workshopId,
    () => updateSeatRoleUnlocked(dataDir, workshopId, seatId, patch, source));
}

const workshopSeatMutations = new Map<string, Promise<unknown>>();

async function withWorkshopSeatMutation<T>(
  dataDir: string, workshopId: string, mutate: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(seatsDir(dataDir, workshopId));
  const previous = workshopSeatMutations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(mutate);
  workshopSeatMutations.set(key, current);
  try { return await current; }
  finally { if (workshopSeatMutations.get(key) === current) workshopSeatMutations.delete(key); }
}

// ── per-seat 并发锁（按 seatId 互斥，非阻塞） ──────────────────
// 工位锁独立于对流的 tryAcquireSessionLock。

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

export function listLockedSeatIds(workshopId: string): string[] {
  const prefix = `${workshopId}/`;
  return [...seatLocks]
    .filter(lockKey => lockKey.startsWith(prefix))
    .map(lockKey => lockKey.slice(prefix.length));
}
