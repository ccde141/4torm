import { loadDispatch, updateDispatch, type CycloneDispatch } from './dispatch-store.js';
import { isDispatchVisibleInRoom } from './dispatch-visibility.js';
import { loadRoom, saveRoom, tryAcquireRoomLock } from './room-store.js';

async function requireRoomDispatch(
  dataDir: string,
  workshopId: string,
  roomId: string,
  dispatchId: string,
): Promise<CycloneDispatch> {
  const [item, room] = await Promise.all([
    loadDispatch(dataDir, workshopId, dispatchId),
    loadRoom(dataDir, workshopId, roomId),
  ]);
  if (!item || !room || item.sourceRoomId !== roomId || !isDispatchVisibleInRoom(item, room)) {
    throw new Error('派发不存在');
  }
  return item;
}

async function saveDecision(
  dataDir: string,
  item: CycloneDispatch,
  patch: Partial<CycloneDispatch>,
): Promise<CycloneDispatch> {
  const updated = await updateDispatch(dataDir, item.workshopId, item.id, patch);
  if (!updated) throw new Error('派发不存在');
  return updated;
}

export async function markDispatchRead(
  dataDir: string, workshopId: string, roomId: string, dispatchId: string,
): Promise<CycloneDispatch> {
  const item = await requireRoomDispatch(dataDir, workshopId, roomId, dispatchId);
  if (item.readState === 'read') return item;
  return saveDecision(dataDir, item, { readState: 'read' });
}

export async function dismissDispatch(
  dataDir: string, workshopId: string, roomId: string, dispatchId: string,
): Promise<CycloneDispatch> {
  const item = await requireRoomDispatch(dataDir, workshopId, roomId, dispatchId);
  if (item.decisionState === 'dismissed') return item;
  if (item.decisionState !== 'pending') throw new Error('该派发已经完成决策，不能忽略');
  return saveDecision(dataDir, item, { decisionState: 'dismissed', readState: 'read' });
}

function assertIncludeable(item: CycloneDispatch): void {
  if (item.decisionState === 'dismissed') throw new Error('已忽略的派发不能带入讨论');
  if (item.decisionState === 'expired') throw new Error('已过期的派发不能带入讨论');
  if (item.decisionState !== 'pending') throw new Error('该派发已经完成决策');
  if (item.status !== 'completed') throw new Error('派发尚未完成，不能带入讨论');
}

export async function includeDispatchResult(
  dataDir: string, workshopId: string, roomId: string, dispatchId: string,
): Promise<CycloneDispatch> {
  const release = tryAcquireRoomLock(workshopId, roomId);
  if (!release) throw new Error('群聊正在运行，请在本轮结束后重试');
  try {
    const item = await requireRoomDispatch(dataDir, workshopId, roomId, dispatchId);
    if (item.decisionState === 'included') return item;
    assertIncludeable(item);
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) throw new Error('群聊不存在');
    const messageId = `dispatch-result-${item.id}`;
    if (!room.publicMessages.some(message => message.id === messageId)) {
      room.publicMessages.push({
        id: messageId,
        speaker: '系统',
        content: `异步工位「${item.targetSeatTitle}」已完成任务「${item.task}」：\n\n${item.response || ''}`,
        timestamp: Date.now(),
        kind: 'dispatch-result',
        dispatchId: item.id,
      });
      await saveRoom(dataDir, workshopId, room);
    }
    return saveDecision(dataDir, item, {
      decisionState: 'included', readState: 'read', includedMessageId: messageId,
    });
  } finally {
    release();
  }
}
