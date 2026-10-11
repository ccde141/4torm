import { phaseFromExecutionStatus, type ExecutionOutcome, type ExecutionPhase } from './execution-phase';
import type { CollaborationProbeItem } from '../../../api/collaboration';

export interface ExecutionIdentityState {
  running: boolean;
  executionId: string | null;
  workflowId: string | null;
  phase: ExecutionPhase;
}

export interface ExecutionStatusUpdate {
  running: boolean;
  authoritative?: boolean;
  executionId?: string;
  workflowId?: string;
  outcome?: ExecutionOutcome | null;
  terminalPhase?: 'interrupted';
}

export function mergeExecutionStatus(
  current: ExecutionIdentityState,
  update: ExecutionStatusUpdate,
): ExecutionIdentityState {
  if (!update.running && current.running && !update.executionId && !update.authoritative) return current;
  if (!update.running && current.running && update.executionId && update.executionId !== current.executionId) return current;

  const executionId = update.executionId ?? current.executionId;
  const workflowId = update.workflowId ?? current.workflowId;
  return {
    running: update.running,
    executionId: update.running ? executionId : null,
    workflowId,
    phase: update.terminalPhase ?? phaseFromExecutionStatus(update, current.phase),
  };
}

export function executionUpdateFromProbe(probe: CollaborationProbeItem): ExecutionStatusUpdate {
  const identity = { executionId: probe.runId, workflowId: probe.operationId };
  if (probe.status === 'queued' || probe.status === 'running' || probe.status === 'waiting') {
    return { running: true, ...identity };
  }
  if (probe.status === 'completed') return { running: false, ...identity, outcome: 'done' };
  if (probe.status === 'aborted') return { running: false, ...identity, outcome: 'stopped' };
  if (probe.status === 'crashed') return { running: false, ...identity, terminalPhase: 'interrupted' };
  if (probe.status === 'failed') return { running: false, ...identity, outcome: 'error' };
  return { running: false, ...identity };
}
