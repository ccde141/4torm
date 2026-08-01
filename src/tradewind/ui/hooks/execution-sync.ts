import { phaseFromExecutionStatus, type ExecutionOutcome, type ExecutionPhase } from './execution-phase';

export interface ExecutionIdentityState {
  running: boolean;
  executionId: string | null;
  workflowId: string | null;
  phase: ExecutionPhase;
}

export interface ExecutionStatusUpdate {
  running: boolean;
  executionId?: string;
  workflowId?: string;
  outcome?: ExecutionOutcome | null;
}

export function mergeExecutionStatus(
  current: ExecutionIdentityState,
  update: ExecutionStatusUpdate,
): ExecutionIdentityState {
  if (!update.running && current.running && !update.executionId) return current;
  if (!update.running && current.running && update.executionId && update.executionId !== current.executionId) return current;

  const executionId = update.executionId ?? current.executionId;
  const workflowId = update.workflowId ?? current.workflowId;
  return {
    running: update.running,
    executionId: update.running ? executionId : null,
    workflowId,
    phase: phaseFromExecutionStatus(update, current.phase),
  };
}
