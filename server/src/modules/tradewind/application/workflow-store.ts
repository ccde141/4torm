import type { WorkflowGraph, WorkflowOrchestration } from '../../../engine/tradewind/foundation/types/index.js';

export interface WorkflowDefinition {
  schemaVersion: 1;
  workflowId: string;
  name: string;
  updatedAt: string;
  graph: WorkflowGraph;
  revision: string;
}

export interface WorkflowSummary {
  orchestration?: WorkflowOrchestration;
  workflowId: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
  revision: string;
}

export interface SaveWorkflowDefinition {
  workflowId: string;
  name: string;
  graph: WorkflowGraph;
  expectedRevision: string | null;
}

export interface TradewindWorkflowStore {
  read(workflowId: string): Promise<WorkflowDefinition>;
  list(): Promise<WorkflowSummary[]>;
  save(input: SaveWorkflowDefinition): Promise<WorkflowDefinition>;
  remove(workflowId: string, expectedRevision: string): Promise<boolean>;
}
