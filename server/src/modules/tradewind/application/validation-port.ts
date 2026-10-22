import type { WorkflowGraph, WorkflowMode } from '../../../engine/tradewind/foundation/types/index.js';

export interface WorkflowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}
export type WorkflowValidationInput = { mode?: WorkflowMode } & (
  { graph: WorkflowGraph; workflowId?: never } | { workflowId: string; graph?: never }
);
export interface WorkflowValidationReport { valid: boolean; issues: WorkflowValidationIssue[] }
export interface TradewindValidationPort {
  validate(input: WorkflowValidationInput): Promise<WorkflowValidationReport>;
}
