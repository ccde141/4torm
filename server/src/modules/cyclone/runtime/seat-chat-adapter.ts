import { prepareCycloneExecution } from '../application/execution-preparation.js';
import { completeAwaitingDispatch, kickDispatchQueue, retainAwaitingDispatchExecutions } from '../../../engine/cyclone/dispatch-queue.js';
import { chatSeatWithinExecution, resumeSeatWithinExecution } from '../../../engine/cyclone/seat-runner.js';
import { throwForReActFailure, type ReActTermination } from '../../../engine/shared/react/outcome.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import type {
  CycloneSeatChatPort,
  PreparedCycloneSeatChat,
  StartCycloneSeatChatInput,
} from '../application/seat-chat.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneChangeFeed } from '../application/change-feed.js';
import type { CycloneInputIdentity } from '../../../engine/cyclone/types.js';

type SeatExecutor = (
  dataDir: string, workshopId: string, seatId: string, text: string,
  onEvent: (event: unknown) => void, signal?: AbortSignal, inputIdentity?: CycloneInputIdentity,
) => Promise<{ content: string; termination: ReActTermination; executionIds?: string[] }>;

export interface CycloneSeatChatRuntime {
  chat: SeatExecutor;
  resume: SeatExecutor;
  completeAwaiting(dataDir: string, workshopId: string, seatId: string, content: string,
    executionIds?: string[], signal?: AbortSignal): Promise<void>;
  retainAwaitingExecutions?(dataDir: string, workshopId: string, seatId: string, executionIds: string[]): Promise<void>;
  kick(dataDir: string, workshopId: string, seatId: string): void;
}

const defaultRuntime: CycloneSeatChatRuntime = {
  chat: chatSeatWithinExecution,
  resume: resumeSeatWithinExecution,
  completeAwaiting: completeAwaitingDispatch,
  retainAwaitingExecutions: retainAwaitingDispatchExecutions,
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
    return prepareCycloneExecution(execution, commands, onEvent => runSeatChat(
      dataDir, input, execution, seats, commands, executions, runtime, onEvent, changes,
    ), () => changes?.publish(input.workshopId, 'activity', input.seatId));
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
  let termination: ReActTermination | undefined;
  let done = false;
  try {
    const execute = input.mode === 'chat' ? runtime.chat : runtime.resume;
    const result = await execute(
      dataDir, input.workshopId, input.seatId, input.text,
      event => {
        const type = seatEventType(event);
        if (type === 'done') {
          changes?.publish(input.workshopId, 'activity', input.seatId);
          done = true;
          return;
        }
        // 终态先提交执行事实，再通知读取方，避免刷新仍读到 running 或将失败当完成。
        if (type === 'error') return;
        onEvent?.(event);
      }, signal, input.mode === 'chat' ? { inputMessageId: execution.runId } : undefined,
    );
    termination = result.termination;
    if (input.mode === 'resume' && result.executionIds?.length) {
      await runtime.retainAwaitingExecutions?.(dataDir, input.workshopId, input.seatId, result.executionIds);
    }
    throwForReActFailure(termination);
    if (input.mode === 'resume' && termination.status === 'succeeded'
      && !(await seats.require(input.workshopId, input.seatId)).pending) {
      await runtime.completeAwaiting(dataDir, input.workshopId, input.seatId, result.content,
        result.executionIds, signal);
    }
  } catch (error) { failure = error; }
  const status = signal.aborted || termination?.status === 'aborted' ? 'aborted' : failure ? 'failed' : 'completed';
  try {
    await commands.finish({ operationId: execution.operationId, runId: execution.runId, status,
      ...(failure ? { error: errorMessage(failure) } : {}) });
    changes?.publish(input.workshopId, 'activity', input.seatId);
  } finally { runtime.kick(dataDir, input.workshopId, input.seatId); }
  if (failure) {
    onEvent?.({ type: 'error', message: errorMessage(failure) });
    throw failure;
  }
  if (done) onEvent?.({ type: 'done' });
}

function seatEventType(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined;
  return (event as { type?: unknown }).type;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
