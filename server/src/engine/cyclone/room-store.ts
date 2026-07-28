/**
 * 气旋群聊 store —— 群聊 CRUD + 拉工位进群/离群 + per-room 并发锁
 *
 * 只 import shared/ 与本目录模块，零交叉代码。
 * per-room 锁：自写一份（按 roomId 互斥），不 import 对流/工位的锁。
 */

import type { ContextMessage, RoomData, RoomMessage } from './types';
import { roomFile, roomsDir, readJsonSafe, ensureDir, atomicWrite, removeStrict, genId, cycloneArchiveFile, dispatchFile } from './paths';
import { loadWorkshop, saveWorkshop } from './workshop-store';
import { loadSeat } from './seat-store';
import { listRoomDispatches } from './dispatch-store';

export class RoomDeleteConflictError extends Error {}
export class RoomSettingsConflictError extends Error {}

async function runRoomSettingsMutation<T>(
  dataDir: string, workshopId: string, roomId: string, mutation: () => Promise<T>,
): Promise<T> {
  const release = tryAcquireRoomLock(workshopId, roomId);
  if (!release) throw new RoomSettingsConflictError('群聊或会长私聊正在处理中，请稍后修改设置');
  try {
    const dispatches = await listRoomDispatches(dataDir, workshopId, roomId);
    const active = dispatches.some(item => (
      item.status === 'queued' || item.status === 'running' || item.status === 'awaiting_human'
    ));
    if (active) throw new RoomSettingsConflictError('该群聊仍有异步派发正在处理中，请先完成或取消');
    return await mutation();
  } finally {
    release();
  }
}

function membershipMessage(
  seatId: string, seatTitle: string, membershipAction: 'joined' | 'left',
): RoomMessage {
  return {
    speaker: '系统',
    content: `${seatTitle}${membershipAction === 'joined' ? '加入' : '离开'}会议`,
    kind: 'membership',
    seatId,
    membershipAction,
    timestamp: Date.now(),
  };
}

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
  const participantSeatIds: string[] = [];
  const publicMessages: RoomMessage[] = [];
  for (const seatId of new Set(opts.participantSeatIds || [])) {
    const seat = await loadSeat(dataDir, workshopId, seatId);
    if (!seat) continue;
    participantSeatIds.push(seatId);
    publicMessages.push(membershipMessage(seatId, seat.title, 'joined'));
  }
  const room: RoomData = {
    id,
    title: opts.title || `群聊 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    topic: opts.topic || '自由讨论',
    mode: opts.mode || 'build',
    participantSeatIds,
    publicMessages,
    chairMessages: [],
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

function archiveName(scope: string, id: string, seq: number): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-${scope}-${id}-${seq}.json`;
}

export async function resetRoomContext(
  dataDir: string,
  workshopId: string,
  roomId: string,
  opts: { scope: 'public' | 'chair' | 'both'; publicSummary?: string; chairSummary?: string },
): Promise<{ room: RoomData | null; archivePath?: string; archivedPublicCount?: number; archivedChairCount?: number }> {
  const room = await loadRoom(dataDir, workshopId, roomId);
  if (!room) return { room: null };

  const state = room.compactState || { disabled: false, archiveSeq: 0 };
  const nextSeq = (state.archiveSeq || 0) + 1;
  const originalPublicMessages = room.publicMessages || [];
  const originalChairMessages = room.chairMessages || [];
  const archivePath = cycloneArchiveFile(dataDir, workshopId, archiveName(`room-${opts.scope}`, roomId, nextSeq));
  await ensureDir(archivePath.replace(/[\\/][^\\/]+$/, ''));
  await atomicWrite(archivePath, JSON.stringify({
    type: 'cyclone-room-context-reset',
    version: 1,
    createdAt: new Date().toISOString(),
    workshopId,
    roomId,
    roomTitle: room.title,
    roomTopic: room.topic,
    roomMode: room.mode,
    scope: opts.scope,
    publicMessages: opts.scope === 'public' || opts.scope === 'both' ? originalPublicMessages : undefined,
    chairMessages: opts.scope === 'chair' || opts.scope === 'both' ? originalChairMessages : undefined,
    tokenUsage: room.tokenUsage || null,
    chairTokenUsage: room.chairTokenUsage || null,
    compactState: room.compactState || null,
    dispatchContextVersion: room.dispatchContextVersion || 0,
  }, null, 2));

  if (opts.scope === 'public' || opts.scope === 'both') {
    room.dispatchContextVersion = (room.dispatchContextVersion ?? 0) + 1;
    room.publicMessages = opts.publicSummary
      ? [{ speaker: '系统', content: `以下是重置前的群聊摘要，请作为后续群聊上下文参考：\n\n${opts.publicSummary}`, timestamp: Date.now() }]
      : [];
    room.tokenUsage = undefined;
  }
  if (opts.scope === 'chair' || opts.scope === 'both') {
    room.chairMessages = opts.chairSummary
      ? [{ role: 'system', content: `以下是重置前的会长私聊摘要，请作为后续会长上下文参考：\n\n${opts.chairSummary}` } as ContextMessage]
      : [];
    room.chairTokenUsage = undefined;
  }
  room.compactState = { ...state, archiveSeq: nextSeq, lastCompactAt: new Date().toISOString() };
  await saveRoom(dataDir, workshopId, room);
  return {
    room,
    archivePath,
    archivedPublicCount: opts.scope === 'public' || opts.scope === 'both' ? originalPublicMessages.length : 0,
    archivedChairCount: opts.scope === 'chair' || opts.scope === 'both' ? originalChairMessages.length : 0,
  };
}

/** 删除群聊（删文件 + 从工作室 meta 摘除；不动任何工位私聊会话） */
export async function deleteRoom(
  dataDir: string, workshopId: string, roomId: string,
): Promise<boolean> {
  if (!await loadRoom(dataDir, workshopId, roomId)) return false;
  const dispatches = await listRoomDispatches(dataDir, workshopId, roomId);
  const activeDispatch = dispatches.find(item => (
    item.status === 'queued' || item.status === 'running' || item.status === 'awaiting_human'
  ));
  if (activeDispatch) throw new RoomDeleteConflictError('该群聊的异步派发仍在处理中，请先完成或取消');

  const w = await loadWorkshop(dataDir, workshopId);
  if (w) {
    w.roomIds = w.roomIds.filter(x => x !== roomId);
    await saveWorkshop(dataDir, w);
  }
  await removeStrict(roomFile(dataDir, workshopId, roomId));
  await Promise.all(dispatches.map(item => removeStrict(dispatchFile(dataDir, workshopId, item.id))));
  return true;
}

/** 拉工位进群（幂等；校验 seatId 真实存在，防脏数据/title 误入） */
export async function joinRoom(
  dataDir: string, workshopId: string, roomId: string, seatId: string,
): Promise<RoomData | null> {
  return runRoomSettingsMutation(dataDir, workshopId, roomId, async () => {
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) return null;
    const seat = await loadSeat(dataDir, workshopId, seatId);
    if (!seat) throw new Error(`工位不存在：${seatId}（必须传 seatId，不是工位名称）`);
    if (room.participantSeatIds.includes(seatId)) return room;
    room.participantSeatIds.push(seatId);
    room.publicMessages.push(membershipMessage(seatId, seat.title, 'joined'));
    await saveRoom(dataDir, workshopId, room);
    return room;
  });
}

/** 工位离群 */
export async function leaveRoom(
  dataDir: string, workshopId: string, roomId: string, seatId: string,
): Promise<RoomData | null> {
  return runRoomSettingsMutation(dataDir, workshopId, roomId, async () => {
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) return null;
    if (!room.participantSeatIds.includes(seatId)) return room;
    const seat = await loadSeat(dataDir, workshopId, seatId);
    room.participantSeatIds = room.participantSeatIds.filter(x => x !== seatId);
    room.publicMessages.push(membershipMessage(seatId, seat?.title || seatId, 'left'));
    await saveRoom(dataDir, workshopId, room);
    return room;
  });
}

/** 设置在场工位完整有序列表（调序/批量增减用，比 reorder(from,to) 更健壮；过滤不存在的工位，顺带清脏数据） */
export async function setRoomParticipants(
  dataDir: string, workshopId: string, roomId: string, seatIds: string[],
): Promise<RoomData | null> {
  return runRoomSettingsMutation(dataDir, workshopId, roomId, async () => {
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) return null;
    const seen = new Set<string>();
    const valid: string[] = [];
    const titles = new Map<string, string>();
    for (const id of seatIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const seat = await loadSeat(dataDir, workshopId, id);
      if (!seat) continue;
      valid.push(id);
      titles.set(id, seat.title);
    }
    const previous = new Set(room.participantSeatIds);
    const next = new Set(valid);
    for (const id of room.participantSeatIds) {
      if (next.has(id)) continue;
      const seat = await loadSeat(dataDir, workshopId, id);
      room.publicMessages.push(membershipMessage(id, seat?.title || id, 'left'));
    }
    for (const id of valid) {
      if (previous.has(id)) continue;
      room.publicMessages.push(membershipMessage(id, titles.get(id) || id, 'joined'));
    }
    room.participantSeatIds = valid;
    await saveRoom(dataDir, workshopId, room);
    return room;
  });
}

/** 重命名群聊 */
export async function renameRoom(
  dataDir: string, workshopId: string, roomId: string, title: string,
): Promise<RoomData | null> {
  return runRoomSettingsMutation(dataDir, workshopId, roomId, async () => {
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) return null;
    const nextTitle = title.trim();
    if (nextTitle) { room.title = nextTitle; await saveRoom(dataDir, workshopId, room); }
    return room;
  });
}

/** 更新群聊话题 */
export async function setRoomTopic(
  dataDir: string, workshopId: string, roomId: string, topic: string,
): Promise<RoomData | null> {
  return runRoomSettingsMutation(dataDir, workshopId, roomId, async () => {
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) return null;
    const nextTopic = topic.trim();
    if (nextTopic) { room.topic = nextTopic; await saveRoom(dataDir, workshopId, room); }
    return room;
  });
}

/** 切换群聊模式（build / plan） */
export async function setRoomMode(
  dataDir: string, workshopId: string, roomId: string, mode: RoomData['mode'],
): Promise<RoomData | null> {
  return runRoomSettingsMutation(dataDir, workshopId, roomId, async () => {
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) return null;
    room.mode = mode === 'plan' ? 'plan' : 'build';
    await saveRoom(dataDir, workshopId, room);
    return room;
  });
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
