import type { CycloneDispatch } from './dispatch-store.js';
import type { RoomData } from './types.js';

export function isDispatchVisibleInRoom(item: CycloneDispatch, room: RoomData): boolean {
  return (item.contextVersion ?? 0) === (room.dispatchContextVersion ?? 0);
}
