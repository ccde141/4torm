import { observeAllFeature, type CollaborationProbeItem } from '../../../api/collaboration';

export interface WorkshopOperationStatus {
  seats: ReadonlyMap<string, CollaborationProbeItem>;
  rooms: ReadonlyMap<string, CollaborationProbeItem>;
}

export function emptyWorkshopOperations(): WorkshopOperationStatus {
  return { seats: new Map(), rooms: new Map() };
}

export async function readWorkshopOperations(workshopId: string): Promise<WorkshopOperationStatus> {
  const items = await observeAllFeature('cyclone', {
    limit: 100, fields: ['parentOperationId', 'phase', 'runId', 'updatedAt'],
  });
  return selectWorkshopOperations(items, workshopId);
}

/** The central probe already combines human and Agent runs with their persisted records. */
export function selectWorkshopOperations(
  items: CollaborationProbeItem[], workshopId: string,
): WorkshopOperationStatus {
  const seats = new Map<string, CollaborationProbeItem>();
  const rooms = new Map<string, CollaborationProbeItem>();
  const seatPrefix = `seat:${workshopId}:`;
  const roomPrefix = `room:${workshopId}:`;
  for (const item of items) {
    if (item.parentOperationId !== workshopId) continue;
    if (item.operationId.startsWith(seatPrefix) && seatPhase(item.phase)) {
      const seatId = item.operationId.slice(seatPrefix.length);
      if (seatId) seats.set(seatId, item);
    } else if (item.operationId.startsWith(roomPrefix) && roomPhase(item.phase)) {
      const roomId = item.operationId.slice(roomPrefix.length);
      if (roomId) rooms.set(roomId, item);
    }
  }
  return { seats, rooms };
}

function seatPhase(phase: string | undefined): boolean {
  return phase === 'seat-chat' || phase === 'seat-resume' || phase === 'seat-compact';
}

function roomPhase(phase: string | undefined): boolean {
  return phase === 'room-speak' || phase === 'room-intro' || phase === 'chair-chat';
}
