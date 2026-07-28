import { listWorkshopDispatches } from './dispatch-store.js';
import { loadRoom, RoomSettingsConflictError, saveRoom, tryAcquireRoomLock } from './room-store.js';
import { deleteSeat, loadSeat } from './seat-store.js';
import type { RoomData, RoomMessage } from './types.js';
import { loadWorkshop } from './workshop-store.js';

const ACTIVE_DISPATCH_STATUSES = new Set(['queued', 'running', 'awaiting_human']);

async function loadAffectedRooms(
  dataDir: string, workshopId: string, seatId: string,
): Promise<RoomData[]> {
  const workshop = await loadWorkshop(dataDir, workshopId);
  if (!workshop) return [];
  const rooms = await Promise.all(workshop.roomIds.map(roomId => loadRoom(dataDir, workshopId, roomId)));
  return rooms.filter((room): room is RoomData => Boolean(room?.participantSeatIds.includes(seatId)));
}

function acquireRoomLocks(workshopId: string, rooms: RoomData[]): Array<() => void> {
  const releases: Array<() => void> = [];
  for (const room of rooms) {
    const release = tryAcquireRoomLock(workshopId, room.id);
    if (release) {
      releases.push(release);
      continue;
    }
    releases.reverse().forEach(unlock => unlock());
    throw new RoomSettingsConflictError('相关会议正在处理中，请稍后删除工位');
  }
  return releases;
}

async function assertDeletionIdle(
  dataDir: string, workshopId: string, seatId: string, rooms: RoomData[],
): Promise<void> {
  const roomIds = new Set(rooms.map(room => room.id));
  const active = (await listWorkshopDispatches(dataDir, workshopId)).some(item => (
    ACTIVE_DISPATCH_STATUSES.has(item.status)
    && (
      item.sourceSeatId === seatId
      || item.targetSeatId === seatId
      || roomIds.has(item.sourceRoomId)
    )
  ));
  if (active) {
    throw new RoomSettingsConflictError('相关会议的异步派发仍在处理中，请先完成或取消');
  }
}

function leaveMessage(seatId: string, seatTitle: string): RoomMessage {
  return {
    speaker: '系统', content: `${seatTitle}离开会议`, kind: 'membership',
    seatId, membershipAction: 'left', timestamp: Date.now(),
  };
}

function historicSeatTitle(rooms: RoomData[], seatId: string): string {
  for (const room of rooms) {
    for (let index = room.publicMessages.length - 1; index >= 0; index -= 1) {
      const message = room.publicMessages[index];
      if (message.seatId !== seatId) continue;
      if (message.kind === 'membership') {
        const suffix = message.membershipAction === 'left' ? '离开会议' : '加入会议';
        if (message.content.endsWith(suffix)) return message.content.slice(0, -suffix.length);
      }
      if (message.speaker !== '系统' && message.speaker !== seatId) return message.speaker;
    }
  }
  return '已删除工位';
}

async function removeSeatFromRooms(
  dataDir: string, workshopId: string, seatId: string, seatTitle: string, rooms: RoomData[],
): Promise<void> {
  for (const room of rooms) {
    room.participantSeatIds = room.participantSeatIds.filter(id => id !== seatId);
    room.publicMessages.push(leaveMessage(seatId, seatTitle));
    await saveRoom(dataDir, workshopId, room);
  }
}

export async function deleteSeatFromWorkshop(
  dataDir: string,
  workshopId: string,
  seatId: string,
): Promise<void> {
  const [seat, rooms] = await Promise.all([
    loadSeat(dataDir, workshopId, seatId),
    loadAffectedRooms(dataDir, workshopId, seatId),
  ]);
  if (!seat && rooms.length === 0) return;
  const releases = acquireRoomLocks(workshopId, rooms);
  try {
    await assertDeletionIdle(dataDir, workshopId, seatId, rooms);
    const seatTitle = seat?.title || historicSeatTitle(rooms, seatId);
    await removeSeatFromRooms(dataDir, workshopId, seatId, seatTitle, rooms);
    if (seat) await deleteSeat(dataDir, workshopId, seatId);
  } finally {
    releases.reverse().forEach(release => release());
  }
}
