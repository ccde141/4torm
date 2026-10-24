import type { RoomData } from './room-messages';

/** Preserve a rendered room while periodic reads report no persisted change. */
export function reconcileRoomSnapshot(current: RoomData | null, incoming: RoomData): RoomData {
  if (!current || JSON.stringify(comparable(current)) !== JSON.stringify(comparable(incoming))) return incoming;
  // A newer projection must take over after the latest measured request at least once.
  const latest = current.modelUsage?.latest?.updatedAt;
  if (latest && current.publicCurrentInput && incoming.publicCurrentInput
    && current.publicCurrentInput.estimatedAt < latest && incoming.publicCurrentInput.estimatedAt >= latest) return incoming;
  return current;
}

function comparable(room: RoomData) {
  const estimate = room.publicCurrentInput;
  if (!estimate) return room;
  const { estimatedAt: _estimatedAt, ...input } = estimate;
  return { ...room, publicCurrentInput: input };
}
