import { invokeFeature } from '../../../api/collaboration';
import type { SeatCollaboration, SeatHistoryFilter, SeatHistoryPage, SeatMemoryDocument, WorkshopConsoleSnapshot } from './workshop-console-model';

export function readWorkshopConsole(workshopId: string): Promise<WorkshopConsoleSnapshot> {
  return invokeFeature('cyclone', 'readWorkshopConsole', { workshopId });
}

export function readSeatHistory(workshopId: string, seatId: string, filter: SeatHistoryFilter,
  cursor?: string, signal?: AbortSignal): Promise<SeatHistoryPage> {
  return invokeFeature('cyclone', 'readSeatHistory', { workshopId, seatId, filter, limit: 20,
    ...(cursor ? { cursor } : {}) }, undefined, { signal });
}

export function readSeatMemory(workshopId: string, seatId: string): Promise<SeatMemoryDocument> {
  return invokeFeature('cyclone', 'readSeatMemory', { workshopId, seatId });
}

export function saveSeatMemory(workshopId: string, seatId: string, expectedRevision: number,
  entry: { id?: string; title: string; content: string }): Promise<SeatMemoryDocument> {
  return invokeFeature('cyclone', 'saveSeatMemory', { workshopId, seatId, expectedRevision, entry });
}

export function updateSeatCollaboration(workshopId: string, seatId: string,
  policy: SeatCollaboration): Promise<SeatCollaboration> {
  return invokeFeature('cyclone', 'updateSeatCollaboration', { workshopId, seatId, ...policy });
}
