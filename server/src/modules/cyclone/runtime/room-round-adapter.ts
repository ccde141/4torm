import { speakInRoom } from '../../../engine/cyclone/room-runner.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneRoomService } from '../application/room-service.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneChangeFeed } from '../application/change-feed.js';
import type {
  CycloneRoomRoundPort,
  PreparedCycloneRoomRound,
  StartCollaborationRoundInput,
} from '../application/collaboration-round.js';

type RoomExecutor = typeof speakInRoom;

export function createCycloneRoomRoundPort(
  dataDir: string,
  rooms: CycloneRoomService,
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  executeRoom: RoomExecutor = speakInRoom,
  changes?: CycloneChangeFeed,
): CycloneRoomRoundPort {
  return {
    prepare: async input => {
      const execution = await commands.begin({
        workshopId: input.workshopId, targetKind: 'room', targetId: input.roomId,
        phase: 'room-speak',
      });
      changes?.publish(input.workshopId, 'activity', input.roomId);
      let room: Awaited<ReturnType<CycloneRoomService['require']>>;
      try {
        room = await rooms.require(input.workshopId, input.roomId);
        if (!room.participantSeatIds.length) throw frameworkError({
          code: 'CYCLONE_ROOM_EMPTY', kind: 'validation',
          message: '群聊没有在场工位，请先加入成员后再启动协作轮次',
          source: 'cyclone.room-round', retryable: false,
        });
      } catch (error) {
        await commands.finish({ operationId: execution.operationId, runId: execution.runId,
          status: 'failed', error: errorMessage(error) });
        changes?.publish(input.workshopId, 'activity', input.roomId);
        throw error;
      }
      return {
        execution,
        run: onEvent => runPreparedRoom(
          dataDir, input, room, execution, commands, executions, onEvent,
          executeRoom, changes,
        ),
      };
    },
  };
}

async function runPreparedRoom(
  dataDir: string,
  input: StartCollaborationRoundInput,
  room: Awaited<ReturnType<CycloneRoomService['require']>>,
  execution: PreparedCycloneRoomRound['execution'],
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  onEvent?: (event: unknown) => void,
  executeRoom: RoomExecutor = speakInRoom,
  changes?: CycloneChangeFeed,
): Promise<void> {
  const signal = executions.signal(execution.operationId, execution.runId);
  const startedAgents = new Set<string>();
  let failure: unknown;
  try {
    await executeRoom(
      dataDir, input.workshopId, room, input.message,
      event => {
        if (event.type === 'seat-start') startedAgents.add(event.agentId);
        if (event.type === 'seat-start' || event.type === 'seat-done') {
          changes?.publish(input.workshopId, 'activity', input.roomId);
        }
        onEvent?.(event);
      }, signal,
    );
  } catch (error) {
    failure = error;
  }
  const status = signal.aborted ? 'aborted' : failure ? 'failed' : 'completed';
  await commands.finish({
    operationId: execution.operationId, runId: execution.runId, status,
    ...(startedAgents.size ? { agentIds: [...startedAgents] } : {}),
    ...(failure ? { error: errorMessage(failure) } : {}),
  });
  changes?.publish(input.workshopId, 'activity', input.roomId);
  if (failure) throw failure;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
