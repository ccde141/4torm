import type { RoomData, RoomMessage } from './types.js';

/** Interrupted work is an execution fact, never a completed participant delivery. */
export function retainRoomExecutionDraft(room: RoomData, status: 'failed' | 'stopped',
  error: string, snapshot = room.publicExecutionDraft): void {
  if (!snapshot) return;
  const record: RoomMessage = { ...snapshot, executionStatus: status, executionError: error };
  if (!room.publicMessages.some(message => record.turnId && message.turnId === record.turnId)) {
    room.publicMessages.push(record);
  }
  room.publicExecutionDraft = undefined;
}
