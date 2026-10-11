import type {
  CollaborationStatus,
  FeatureOperationHandler,
  OperationIdentity,
} from '../../../engine/collaboration/contracts.js';

export interface TradewindExecutionSnapshot {
  operationId: string;
  title: string;
  status: CollaborationStatus;
  parentOperationId?: string;
  runId?: string;
  phase?: string;
  updatedAt?: string;
  waitingReason?: string;
  errorCode?: string;
  errorMessage?: string;
  resultSummary?: string;
  agentId?: string;
}

export interface TradewindRuntimeSource {
  snapshots(): Promise<TradewindExecutionSnapshot[]>;
  inspect?(identity: OperationIdentity): Promise<TradewindExecutionSnapshot | null>;
  subscribe?: NonNullable<FeatureOperationHandler['subscribe']>;
}
