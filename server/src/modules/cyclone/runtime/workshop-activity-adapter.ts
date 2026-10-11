import { readWorkshopExternalSeatActivities } from '../../../engine/cyclone/seat-activity.js';
import { listLockedSeatIds } from '../../../engine/cyclone/seat-store.js';
import type { WorkshopActivityPort } from '../domain/workshop-activity.js';

export function createWorkshopActivityPort(): WorkshopActivityPort {
  return {
    read: workshopId => ({
      runningSeatIds: listLockedSeatIds(workshopId),
      activities: readWorkshopExternalSeatActivities(workshopId),
    }),
  };
}
