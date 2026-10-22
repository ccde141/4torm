import { invokeFeature } from '../../../api/collaboration';
import type { WorkflowGraph, WorkflowMode } from '../../types';

export interface WorkflowIssue { code: string; message: string; nodeId?: string; edgeId?: string }
export interface WorkflowValidation { valid: boolean; issues: WorkflowIssue[] }

export function validateWorkflow(graph: WorkflowGraph, mode: WorkflowMode) {
  return invokeFeature<WorkflowValidation>('tradewind', 'validateWorkflow', { graph, mode });
}
