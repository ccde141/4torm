import { loadSeat, tryAcquireSeatLock } from '../../../engine/cyclone/seat-store.js';
import { generateJoinSpeech } from '../../../engine/cyclone/seat-summary.js';
import { beginExternalSeatActivity } from '../../../engine/cyclone/seat-activity.js';
import type { RoomData } from '../../../engine/cyclone/types.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { CycloneRoomService } from '../application/room-service.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneChangeFeed } from '../application/change-feed.js';
import type {
  CycloneRoomIntroductionPort,
  PreparedCycloneRoomIntroduction,
  StartRoomIntroductionInput,
} from '../application/room-introduction.js';

export interface CycloneRoomIntroductionRuntime {
  loadSeat(dataDir: string, workshopId: string, seatId: string): Promise<{
    title: string; agentId: string;
  } | null>;
  acquireSeat(workshopId: string, seatId: string): (() => void) | null;
  beginActivity(workshopId: string, seatId: string, roomTitle: string): { finish(): void };
  generate(dataDir: string, workshopId: string, room: RoomData, seatId: string,
    behavior: 'summary' | 'intro', onChunk: (chunk: string) => void,
    signal: AbortSignal, onUsage?: (usage: TokenUsage | null) => void): Promise<string | null>;
}

const defaultRuntime: CycloneRoomIntroductionRuntime = {
  loadSeat,
  acquireSeat: tryAcquireSeatLock,
  beginActivity: (workshopId, seatId, roomTitle) => beginExternalSeatActivity(
    workshopId, seatId, 'join-summary', `正在为「${roomTitle}」整理入会摘要`,
  ),
  generate: generateJoinSpeech,
};

export function createCycloneRoomIntroductionPort(
  dataDir: string,
  rooms: CycloneRoomService,
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  runtime: CycloneRoomIntroductionRuntime = defaultRuntime,
  changes?: CycloneChangeFeed,
): CycloneRoomIntroductionPort {
  return { prepare: async input => {
    const room = await rooms.require(input.workshopId, input.roomId);
    const execution = await commands.begin({
      workshopId: input.workshopId, targetKind: 'room', targetId: input.roomId,
      phase: 'room-intro',
    });
    changes?.publish(input.workshopId, 'activity', input.roomId);
    return { execution, run: onEvent => runIntroduction(
      dataDir, input, room, execution, commands, executions, runtime, onEvent, changes,
    ) };
  } };
}

async function runIntroduction(
  dataDir: string,
  input: StartRoomIntroductionInput,
  room: RoomData,
  execution: PreparedCycloneRoomIntroduction['execution'],
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  runtime: CycloneRoomIntroductionRuntime,
  onEvent?: (event: unknown) => void,
  changes?: CycloneChangeFeed,
): Promise<void> {
  const signal = executions.signal(execution.operationId, execution.runId);
  const startedAgents = new Set<string>();
  let failure: unknown;
  try { await introduceSeats(dataDir, input, room, signal, runtime, startedAgents, onEvent); }
  catch (error) { failure = error; }
  const status = signal.aborted ? 'aborted' : failure ? 'failed' : 'completed';
  await commands.finish({ operationId: execution.operationId, runId: execution.runId, status,
    ...(startedAgents.size ? { agentIds: [...startedAgents] } : {}),
    ...(failure ? { error: errorMessage(failure) } : {}) });
  changes?.publish(input.workshopId, 'activity', input.roomId);
  if (failure) throw failure;
}

async function introduceSeats(
  dataDir: string,
  input: StartRoomIntroductionInput,
  room: RoomData,
  signal: AbortSignal,
  runtime: CycloneRoomIntroductionRuntime,
  startedAgents: Set<string>,
  onEvent?: (event: unknown) => void,
): Promise<void> {
  for (const intro of input.intros) {
    if (signal.aborted) break;
    if (intro.behavior === 'none') continue;
    const seat = await runtime.loadSeat(dataDir, input.workshopId, intro.seatId);
    if (!seat) continue;
    const release = runtime.acquireSeat(input.workshopId, intro.seatId);
    if (!release) {
      onEvent?.({ type: 'error', message: `工位「${seat.title}」正在处理其他任务，已跳过入会发言` });
      continue;
    }
    const activity = runtime.beginActivity(input.workshopId, intro.seatId, room.title);
    startedAgents.add(seat.agentId);
    onEvent?.({ type: 'seat-start', speaker: seat.title });
    try {
      const speech = await runtime.generate(
        dataDir, input.workshopId, room, intro.seatId, intro.behavior,
        content => onEvent?.({ type: 'token', speaker: seat.title, content }), signal,
        usage => onEvent?.({ type: 'usage', usage }),
      );
      if (speech) onEvent?.({ type: 'seat-done', speaker: seat.title, content: speech });
    } finally { activity.finish(); release(); }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
