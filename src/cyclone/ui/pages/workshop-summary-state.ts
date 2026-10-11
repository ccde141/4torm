import type { BulletinEntry } from './BulletinBoard';
import type { RoomSummary, SeatSummary } from './cyclone-page-model';

/** The selected workshop's human and Agent changes share one persisted summary. */
export interface WorkshopSnapshot {
  workshopId: string;
  chairAgentId: string | null;
  seats: SeatSummary[];
  rooms: RoomSummary[];
  bulletin: BulletinEntry[];
}

export function reconcileWorkshopSummary(
  current: WorkshopSnapshot | null, incoming: WorkshopSnapshot,
): WorkshopSnapshot {
  return current && JSON.stringify(current) === JSON.stringify(incoming) ? current : incoming;
}
