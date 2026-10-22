import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';
import type { CycloneRoomActivity } from './room-activity.js';
import type { CycloneRoomService } from './room-service.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';

export interface StartCollaborationRoundInput {
  workshopId: string;
  roomId: string;
  message: string;
}

export interface PreparedCycloneRoomRound {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
  dispose(cause?: unknown): Promise<void>;
}

export interface CycloneRoomRoundPort {
  prepare(input: StartCollaborationRoundInput): Promise<PreparedCycloneRoomRound>;
}

type BackgroundFailureReporter = (error: unknown) => void;

export class CycloneCollaborationRoundService {
  constructor(
    private readonly rounds: CycloneRoomRoundPort,
    private readonly rooms: Pick<CycloneRoomService, 'require'>,
    private readonly reportFailure: BackgroundFailureReporter = defaultFailureReporter,
    private readonly activity?: CycloneRoomActivity,
  ) {}

  async start(input: StartCollaborationRoundInput): Promise<CycloneExecutionSnapshot> {
    const room = await this.rooms.require(input.workshopId, input.roomId);
    if (!room.participantSeatIds.length) throw frameworkError({
      code: 'CYCLONE_ROOM_EMPTY', kind: 'validation',
      message: '群聊没有在场工位，请先加入成员后再启动协作轮次',
      source: 'cyclone.collaboration-round', retryable: false,
    });
    const prepared = await this.rounds.prepare(input);
    const activity = this.activity?.begin(prepared.execution, input.message);
    try {
      void prepared.run(event => activity?.emit(event as Record<string, unknown>))
        .catch(error => this.reportFailure(error))
        .finally(() => activity?.finish());
    } catch (error) {
      activity?.finish();
      throw error;
    }
    return prepared.execution;
  }
}

function defaultFailureReporter(error: unknown): void {
  console.error('[cyclone] Agent 启动的协作轮次失败', error);
}
