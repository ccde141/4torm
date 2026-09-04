import type { CycloneDispatch } from './dispatch-timeline';
import type { RoomSummary, SeatSummary } from './cyclone-page-model';
import type { SeatRunnerOutcome } from './useSeatStreamRunners';

export type WorkspaceEntityStatus = 'idle' | 'running' | 'waiting' | 'failed' | 'unread';

interface RunnerState {
  streaming: boolean;
  outcome?: SeatRunnerOutcome;
}

interface Input {
  seats: SeatSummary[];
  rooms: RoomSummary[];
  dispatches: CycloneDispatch[];
  getSeatRunner(id: string): RunnerState | undefined;
  getRoomRunner(id: string): RunnerState | undefined;
  chairKey(roomId: string): string;
}

export interface WorkspaceStatusProjection {
  seats: Map<string, WorkspaceEntityStatus>;
  rooms: Map<string, WorkspaceEntityStatus>;
}

export function projectWorkspaceStatus(input: Input): WorkspaceStatusProjection {
  const seats = new Map<string, WorkspaceEntityStatus>();
  const rooms = new Map<string, WorkspaceEntityStatus>();
  for (const seat of input.seats) {
    seats.set(seat.id, projectSeat(seat, input.dispatches.filter(item => item.targetSeatId === seat.id), input.getSeatRunner(seat.id)));
  }
  for (const room of input.rooms) {
    const running = input.getRoomRunner(room.id)?.streaming || input.getSeatRunner(input.chairKey(room.id))?.streaming;
    rooms.set(room.id, projectDispatches(input.dispatches.filter(item => item.sourceRoomId === room.id), !!running));
  }
  return { seats, rooms };
}

function projectSeat(seat: SeatSummary, dispatches: CycloneDispatch[], runner?: RunnerState): WorkspaceEntityStatus {
  if (runner?.streaming) return 'running';
  if (seat.pending) return 'waiting';
  if (runner?.outcome === 'failed') return 'failed';
  return projectDispatches(dispatches, false);
}

function projectDispatches(dispatches: CycloneDispatch[], alreadyRunning: boolean): WorkspaceEntityStatus {
  if (alreadyRunning || dispatches.some(item => item.status === 'queued' || item.status === 'running')) return 'running';
  if (dispatches.some(item => item.status === 'awaiting_human')) return 'waiting';
  if (dispatches.some(item => item.status === 'failed' && item.readState === 'unread')) return 'failed';
  if (dispatches.some(item => item.status === 'completed' && item.readState === 'unread')) return 'unread';
  return 'idle';
}
