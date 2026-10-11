import { invokeFeature } from '../../../api/collaboration.js';
import type { CycloneDispatch } from './dispatch-timeline.js';

export type DispatchAction = 'read' | 'include' | 'dismiss';

export function actOnDispatch(
  workshopId: string,
  roomId: string,
  dispatchId: string,
  action: DispatchAction,
): Promise<CycloneDispatch> {
  return invokeFeature('cyclone', 'actOnDispatch', {
    workshopId, roomId, dispatchId, action,
  });
}

export function markSeatDispatchesRead(
  workshopId: string,
  seatId: string,
): Promise<CycloneDispatch[]> {
  return invokeFeature('cyclone', 'markSeatDispatchesRead', { workshopId, seatId });
}
