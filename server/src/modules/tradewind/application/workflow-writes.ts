import type { SaveWorkflowDefinition, WorkflowDefinition } from './workflow-store.js';

export interface TradewindWorkflowWrites {
  save(input: SaveWorkflowDefinition): Promise<WorkflowDefinition>;
  remove(workflowId: string, expectedRevision: string): Promise<boolean>;
}
