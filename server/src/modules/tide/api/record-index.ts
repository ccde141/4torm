import type { OperationRecordSummary } from '../../../engine/collaboration/contracts.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import type { TideRunRepository } from '../infrastructure/run-repository.js';

/** Index stored runs using execution-time facts; configuration is only attribution. */
export async function listTideOperationRecords(
  tasks: TideTaskRepository,
  states: TideRunStateRepository,
  runs: TideRunRepository,
): Promise<OperationRecordSummary[]> {
  const taskById = new Map((await tasks.read()).tasks.map(task => [task.id, task]));
  const activeStates = (await states.listAll()).filter(state => taskById.has(state.taskId));
  return Promise.all(activeStates.map(async state => {
    const task = taskById.get(state.taskId)!;
    const detail = await runs.get(state.taskId, state.runId);
    const confirmed = state.status === 'completed' && detail?.status === 'success';
    return {
      operationId: state.taskId, runId: state.runId,
      title: task.name,
      status: state.status, timestamp: state.createdAt,
      ...(state.agentId ? { agentId: state.agentId } : {}),
      ...(confirmed && detail.pushMode === 'designated'
        ? { linkedSessionId: detail.sessionId } : {}),
      ...(confirmed && detail.pushMode === 'accumulate'
        ? { sessionId: detail.sessionId } : {}),
    };
  }));
}
