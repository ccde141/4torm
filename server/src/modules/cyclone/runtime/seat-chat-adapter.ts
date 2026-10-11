import { completeAwaitingDispatch, kickDispatchQueue } from '../../../engine/cyclone/dispatch-queue.js';
import { chatSeatWithinExecution, resumeSeatWithinExecution } from '../../../engine/cyclone/seat-runner.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import type {
  CycloneSeatChatPort,
  PreparedCycloneSeatChat,
  StartCycloneSeatChatInput,
} from '../application/seat-chat.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneChangeFeed } from '../application/change-feed.js';

type SeatExecutor = (
  dataDir: string, workshopId: string, seatId: string, text: string,
  onEvent: (event: unknown) => void, signal?: AbortSignal,
) => Promise<{ content: string }>;

export interface CycloneSeatChatRuntime {
  chat: SeatExecutor;
  resume: SeatExecutor;
  completeAwaiting(dataDir: string, workshopId: string, seatId: string, content: string): Promise<void>;
  kick(dataDir: string, workshopId: string, seatId: string): void;
}

const defaultRuntime: CycloneSeatChatRuntime = {
  chat: chatSeatWithinExecution,
  resume: resumeSeatWithinExecution,
  completeAwaiting: completeAwaitingDispatch,
  kick: kickDispatchQueue,
};

export function createCycloneSeatChatPort(
  dataDir: string,
  seats: CycloneSeatService,
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  runtime: CycloneSeatChatRuntime = defaultRuntime,
  changes?: CycloneChangeFeed,
): CycloneSeatChatPort {
  return { prepare: async input => {
    const seat = await seats.require(input.workshopId, input.seatId);
    const execution = await commands.begin({
      workshopId: input.workshopId, targetKind: 'seat', targetId: input.seatId,
      phase: input.mode === 'chat' ? 'seat-chat' : 'seat-resume',
      agentId: seat.agentId,
    });
    changes?.publish(input.workshopId, 'activity', input.seatId);
    return { execution, run: onEvent => runSeatChat(
      dataDir, input, execution, seats, commands, executions, runtime, onEvent, changes,
    ) };
  } };
}

async function runSeatChat(
  dataDir: string,
  input: StartCycloneSeatChatInput,
  execution: PreparedCycloneSeatChat['execution'],
  seats: CycloneSeatService,
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  runtime: CycloneSeatChatRuntime,
  onEvent?: (event: unknown) => void,
  changes?: CycloneChangeFeed,
): Promise<void> {
  const signal = executions.signal(execution.operationId, execution.runId);
  let failure: unknown;
  try {
    const execute = input.mode === 'chat' ? runtime.chat : runtime.resume;
    const result = await execute(
      dataDir, input.workshopId, input.seatId, input.text,
      event => {
        if (isCommittedSeatEvent(event)) {
          changes?.publish(input.workshopId, 'activity', input.seatId);
        }
        onEvent?.(event);
      }, signal,
    );
    if (input.mode === 'resume' && !(await seats.require(input.workshopId, input.seatId)).pending) {
      await runtime.completeAwaiting(dataDir, input.workshopId, input.seatId, result.content);
    }
  } catch (error) { failure = error; }
  const status = signal.aborted ? 'aborted' : failure ? 'failed' : 'completed';
  try {
    await commands.finish({ operationId: execution.operationId, runId: execution.runId, status,
      ...(failure ? { error: errorMessage(failure) } : {}) });
    changes?.publish(input.workshopId, 'activity', input.seatId);
  } finally { runtime.kick(dataDir, input.workshopId, input.seatId); }
  if (failure) throw failure;
}

function isCommittedSeatEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  return (event as { type?: unknown }).type === 'done';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
