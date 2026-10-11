import type { RoomData } from './room-messages';

/** Preserve a rendered room while periodic reads report no persisted change. */
export function reconcileRoomSnapshot(current: RoomData | null, incoming: RoomData): RoomData {
  return current && JSON.stringify(current) === JSON.stringify(incoming) ? current : incoming;
}
