import type { CycloneDispatch } from './dispatch-timeline';
import type { RoomSummary, SeatSummary } from './cyclone-page-model';
import type { SeatRunnerOutcome } from './useSeatStreamRunners';
import type { CollaborationProbeItem, CollaborationStatus } from '../../../api/collaboration';
import type { WorkshopOperationStatus } from './workshop-operation-status';

export type WorkspaceEntityStatus = 'idle' | 'running' | 'waiting' | 'unknown' | 'failed' | 'unread';

interface RunnerState {
  streaming: boolean;
  outcome?: SeatRunnerOutcome;
  runId?: string;
}

interface Input {
  seats: SeatSummary[];
  rooms: RoomSummary[];
  dispatches: CycloneDispatch[];
  getSeatRunner(id: string): RunnerState | undefined;
  getRoomRunner(id: string): RunnerState | undefined;
  chairKey(roomId: string): string;
  externalRoom?: { roomId: string; running: boolean; status?: CollaborationStatus };
  operations?: WorkshopOperationStatus;
  uncertain?: { seats: ReadonlySet<string>; rooms: ReadonlySet<string> };
}

export interface WorkspaceStatusProjection {
  seats: Map<string, WorkspaceEntityStatus>;
  rooms: Map<string, WorkspaceEntityStatus>;
}

export function projectWorkspaceStatus(input: Input): WorkspaceStatusProjection {
  const seats = new Map<string, WorkspaceEntityStatus>();
  const rooms = new Map<string, WorkspaceEntityStatus>();
  for (const seat of input.seats) {
    seats.set(seat.id, prioritize([
      runnerStatus(input.getSeatRunner(seat.id), input.operations?.seats.get(seat.id)),
      seat.pending ? 'waiting' : 'idle',
      factStatus(input.operations?.seats.get(seat.id)),
      input.uncertain?.seats.has(seat.id) ? 'unknown' : 'idle',
      projectDispatches(input.dispatches.filter(item => item.targetSeatId === seat.id)),
    ]));
  }
  for (const room of input.rooms) {
    const external = input.externalRoom?.roomId === room.id ? input.externalRoom : undefined;
    const fact = input.operations?.rooms.get(room.id);
    const chairStreaming = input.getSeatRunner(input.chairKey(room.id))?.streaming;
    rooms.set(room.id, prioritize([
      input.getRoomRunner(room.id)?.streaming ? 'running' : 'idle',
      chairStreaming ? 'running' : 'idle',
      runnerStatus(input.getSeatRunner(input.chairKey(room.id)), fact),
      external?.running ? 'running' : 'idle',
      factStatus(fact),
      input.uncertain?.rooms.has(room.id) ? 'unknown' : 'idle',
      !fact && (external?.status === 'failed' || external?.status === 'crashed') ? 'failed' : 'idle',
      projectDispatches(input.dispatches.filter(item => item.sourceRoomId === room.id)),
    ]));
  }
  return { seats, rooms };
}

function runnerStatus(runner: RunnerState | undefined,
  fact: CollaborationProbeItem | undefined): WorkspaceEntityStatus {
  if (runner?.streaming) return 'running';
  if (runner?.outcome !== 'failed') return 'idle';
  if (runner.runId && fact?.runId && (runner.runId !== fact.runId
    || fact.status === 'completed' || fact.status === 'aborted')) return 'idle';
  return 'failed';
}

function factStatus(fact: CollaborationProbeItem | undefined): WorkspaceEntityStatus {
  if (fact?.status === 'running' || fact?.status === 'queued') return 'running';
  if (fact?.status === 'waiting') return 'waiting';
  if (fact?.status === 'failed' || fact?.status === 'crashed') return 'failed';
  return 'idle';
}

function projectDispatches(dispatches: CycloneDispatch[]): WorkspaceEntityStatus {
  if (dispatches.some(item => item.status === 'queued' || item.status === 'running')) return 'running';
  if (dispatches.some(item => item.status === 'awaiting_human')) return 'waiting';
  if (dispatches.some(item => item.status === 'failed' && item.readState === 'unread')) return 'failed';
  if (dispatches.some(item => item.status === 'completed' && item.readState === 'unread')) return 'unread';
  return 'idle';
}

function prioritize(statuses: WorkspaceEntityStatus[]): WorkspaceEntityStatus {
  for (const status of ['running', 'waiting', 'unknown', 'failed', 'unread'] as const) {
    if (statuses.includes(status)) return status;
  }
  return 'idle';
}
