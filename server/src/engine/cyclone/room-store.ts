/**
 * 气旋群聊 store —— 群聊 CRUD + 拉工位进群/离群 + per-room 并发锁
 *
 * 只 import shared/ 与本目录模块，零交叉代码。
 * per-room 锁：自写一份（按 roomId 互斥），不 import 对流/工位的锁。
 */

import fs from 'node:fs/promises';
import type { RoomData } from './types';
import { roomFile, roomsDir, readJsonSafe, ensureDir, atomicWrite, genId } from './paths';
import { loadWorkshop, saveWorkshop } from './workshop-store';
import { loadSeat } from './seat-store';

/** 在工作室下新建群聊，更新工作室 meta */
export async function createRoom(
  dataDir: string,
  workshopId: string,
  opts: { title?: string; topic?: string; participantSeatIds?: string[]; mode?: RoomData['mode'] } = {},
): Promise<RoomData> {
  const w = await loadWorkshop(dataDir, workshopId);
  if (!w) throw new Error(`工作室不存在：${workshopId}`);
  const id = genId('room');
  const now = new Date().toISOString();
  const room: RoomData = {
    id,
    title: opts.title || `群聊 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    topic: opts.topic || '自由讨论',
    mode: opts.mode || 'build',
    participantSeatIds: opts.participantSeatIds || [],
    publicMessages: [],
    createdAt: now,
    updatedAt: now,
  };
  await ensureDir(roomsDir(dataDir, workshopId));
  await atomicWrite(roomFile(dataDir, workshopId, id), JSON.stringify(room, null, 2));
  if (!w.roomIds.includes(id)) {
    w.roomIds.push(id);
    await saveWorkshop(dataDir, w);
  }
  return room;
}

/** 加载群聊（不存在返回 null） */
export async function loadRoom(
  dataDir: string, workshopId: string, roomId: string,
): Promise<RoomData | null> {
  return readJsonSafe<RoomData>(roomFile(dataDir, workshopId, roomId));
}

/** 保存群聊（刷新 updatedAt） */
export async function saveRoom(
  dataDir: string, workshopId: string, room: RoomData,
): Promise<void> {
  room.updatedAt = new Date().toISOString();
  await atomicWrite(roomFile(dataDir, workshopId, room.id), JSON.stringify(room, null, 2));
}

/** 删除群聊（删文件 + 从工作室 meta 摘除；不动任何工位私聊会话） */
export async function deleteRoom(
  dataDir: string, workshopId: string, roomId: string,
): Promise<void> {
  try { await fs.rm(roomFile(dataDir, workshopId, roomId)); } catch {}
  const w = await loadWorkshop(dataDir, workshopId);
  if (w) {
    w.roomIds = w.roomIds.filter(x => x !== roomId);
    await saveWorkshop(dataDir, w);
  }
}

/** 拉工位进群（幂等；校验 seatId 真实存在，防脏数据/title 误入） */
export async function joinRoom(
  dataDir: string, workshopId: string, roomId: string, seatId: string,
): Promise<RoomData | null> {
  const room = await loadRoom(dataDir, workshopId, roomId);
  if (!room) return null;
  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) throw new Error(`工位不存在：${seatId}（必须传 seatId，不是工位名称）`);
  if (!room.participantSeatIds.includes(seatId)) {
    room.participantSeatIds.push(seatId);
    await saveRoom(dataDir, workshopId, room);
  }
  return room;
}

/** 工位离群 */
export async function leaveRoom(
  dataDir: string, workshopId: string, roomId: string, seatId: string,
): Promise<RoomData | null> {
  const room = await loadRoom(dataDir, workshopId, roomId);
  if (!room) return null;
  room.participantSeatIds = room.participantSeatIds.filter(x => x !== seatId);
  await saveRoom(dataDir, workshopId, room);
  return room;
}

/** 设置在场工位完整有序列表（调序/批量增减用，比 reorder(from,to) 更健壮；过滤不存在的工位，顺带清脏数据） */
export async function setRoomParticipants(
  dataDir: string, workshopId: string, roomId: string, seatIds: string[],
): Promise<RoomData | null> {
  const room = await loadRoom(dataDir, workshopId, roomId);
  if (!room) return null;
  // 去重保序 + 过滤真实存在的工位
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const id of seatIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (await loadSeat(dataDir, workshopId, id)) valid.push(id);
  }
  room.participantSeatIds = valid;
  await saveRoom(dataDir, workshopId, room);
  return room;
}

/** 重命名群聊 */
export async function renameRoom(
  dataDir: string, workshopId: string, roomId: string, title: string,
): Promise<RoomData | null> {
  const room = await loadRoom(dataDir, workshopId, roomId);
  if (!room) return null;
  const t = title.trim();
  if (t) { room.title = t; await saveRoom(dataDir, workshopId, room); }
  return room;
}

/** 切换群聊模式（build / plan） */
export async function setRoomMode(
  dataDir: string, workshopId: string, roomId: string, mode: RoomData['mode'],
): Promise<RoomData | null> {
  const room = await loadRoom(dataDir, workshopId, roomId);
  if (!room) return null;
  room.mode = mode === 'plan' ? 'plan' : 'build';
  await saveRoom(dataDir, workshopId, room);
  return room;
}

// ── per-room 并发锁（按 roomId 互斥，非阻塞） ──────────────────

const roomLocks = new Set<string>();

/**
 * 尝试获取群聊锁。返回 release 函数表示成功；返回 null 表示已被占用。
 * 锁键 = workshopId/roomId。
 */
export function tryAcquireRoomLock(workshopId: string, roomId: string): (() => void) | null {
  const key = `${workshopId}/${roomId}`;
  if (roomLocks.has(key)) return null;
  roomLocks.add(key);
  return () => { roomLocks.delete(key); };
}
