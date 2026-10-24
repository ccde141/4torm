import { prepareCycloneExecution } from '../application/execution-preparation.js';
import { chatChairWithinExecution } from '../../../engine/cyclone/chair-runner.js';
import type { CycloneChairService } from '../application/chair-service.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import type {
  CycloneChairChatPort,
  PreparedCycloneChairChat,
  StartCycloneChairChatInput,
} from '../application/chair-chat.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneChangeFeed } from '../application/change-feed.js';

type ChairExecutor = typeof chatChairWithinExecution;

export function createCycloneChairChatPort(
  dataDir: string,
  chair: CycloneChairService,
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  execute: ChairExecutor = chatChairWithinExecution,
  changes?: CycloneChangeFeed,
): CycloneChairChatPort {
  return { prepare: async input => {
    const status = await chair.status(input.workshopId, input.roomId);
    const execution = await commands.begin({
      workshopId: input.workshopId, targetKind: 'room', targetId: input.roomId,
      phase: 'chair-chat',
      agentId: status.chairAgentId,
    });
    changes?.publish(input.workshopId, 'activity', input.roomId);
    return prepareCycloneExecution(execution, commands, onEvent => runChairChat(
      dataDir, input, execution, commands, executions, execute, onEvent, changes,
    ), () => changes?.publish(input.workshopId, 'activity', input.roomId));
  } };
}

async function runChairChat(
  dataDir: string,
  input: StartCycloneChairChatInput,
  execution: PreparedCycloneChairChat['execution'],
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  execute: ChairExecutor,
  onEvent?: (event: unknown) => void,
  changes?: CycloneChangeFeed,
): Promise<void> {
  const signal = executions.signal(execution.operationId, execution.runId);
  let failure: unknown;
  try {
    await execute(
      dataDir, input.workshopId, input.roomId, input.message,
      event => onEvent?.(event), signal, { inputMessageId: execution.runId },
    );
  } catch (error) { failure = error; }
  const status = signal.aborted ? 'aborted' : failure ? 'failed' : 'completed';
  await commands.finish({ operationId: execution.operationId, runId: execution.runId, status,
    ...(failure ? { error: errorMessage(failure) } : {}) });
  changes?.publish(input.workshopId, 'activity', input.roomId);
  if (failure) throw failure;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
