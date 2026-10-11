import type { CollaborationStatus } from '../../../engine/collaboration/contracts.js';

export interface CycloneOperationSnapshot {
  operationId: string;
  title: string;
  status: CollaborationStatus;
  parentOperationId?: string;
  phase?: string;
  runId?: string;
  updatedAt?: string;
  waitingReason?: string;
  errorCode?: string;
  errorMessage?: string;
  agentId?: string;
}

export interface CycloneRuntimeSource {
  snapshots(): Promise<CycloneOperationSnapshot[]>;
}

export type CycloneTargetKind = 'seat' | 'room';

export function cycloneOperationId(
  targetKind: CycloneTargetKind,
  workshopId: string,
  targetId: string,
): string {
  return `${targetKind}:${workshopId}:${targetId}`;
}

export type CycloneExecutionPhase =
  | 'seat-chat' | 'seat-resume' | 'seat-compact'
  | 'chair-chat' | 'room-intro' | 'room-speak';

export interface CycloneExecutionTarget {
  workshopId: string;
  targetKind: CycloneTargetKind;
  targetId: string;
  phase: CycloneExecutionPhase;
  /** Captured binding at execution start, not inferred from a later seat edit. */
  agentId?: string;
}

export interface CycloneExecutionSnapshot extends CycloneExecutionTarget {
  operationId: string;
  runId: string;
  startedAt: string;
}

export type CycloneRunStatus = 'running' | 'completed' | 'aborted' | 'failed' | 'crashed';

export interface CycloneRunSnapshot extends CycloneExecutionSnapshot {
  status: CycloneRunStatus;
  updatedAt: string;
  error?: string;
  /** Agents that actually started a room turn, captured at execution time. */
  agentIds?: string[];
}

export interface CycloneRunObservationPort {
  latest(operationId: string): Promise<CycloneRunSnapshot | null>;
  list(): Promise<CycloneRunSnapshot[]>;
}

export interface CycloneExecutionPort {
  signal(operationId: string, runId: string): AbortSignal;
  list(): CycloneExecutionSnapshot[];
}
