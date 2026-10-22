import type { WorkflowGraph } from '../types';
import { invokeFeature } from '../../api/collaboration';

export interface SaveWorkflowInput {
  workflowId: string;
  name: string;
  graph: WorkflowGraph;
  expectedRevision: string | null;
}

export interface SaveWorkflowResult {
  saved: true;
  workflowId: string;
  name: string;
  revision: string;
  orchestration?: 'strict' | 'handoff';
}

export function saveWorkflow(input: SaveWorkflowInput, fallback = '保存工作流失败') {
  return invokeFeature<SaveWorkflowResult>('tradewind', 'saveWorkflow', input, fallback);
}

export interface WorkflowDefinition extends Omit<SaveWorkflowInput, 'expectedRevision'> {
  schemaVersion: 1;
  updatedAt: string;
  revision: string;
}

export interface WorkflowSummary {
  workflowId: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
  revision: string;
  orchestration?: 'strict' | 'handoff';
}

export interface WorkflowChangeEvent {
  scope: 'workflow';
  type: 'workflow-changed';
  workflowId: string;
  revision: string | null;
  change: 'created' | 'updated' | 'deleted';
}

export function loadWorkflow(workflowId: string, fallback = '加载工作流失败') {
  return invokeFeature<WorkflowDefinition>(
    'tradewind', 'loadWorkflow', { workflowId }, fallback,
  );
}

export function listWorkflows(fallback = '读取工作流列表失败') {
  return invokeFeature<WorkflowSummary[]>('tradewind', 'listWorkflowSummaries', {}, fallback);
}

export async function openWorkflowWorkspace(workflowId: string, fallback = '打开工作流工作区失败'): Promise<void> {
  await invokeFeature('tradewind', 'openWorkflowWorkspace', { workflowId }, fallback);
}

export async function deleteWorkflow(workflowId: string, expectedRevision: string, fallback = '删除工作流失败'): Promise<void> {
  await invokeFeature('tradewind', 'deleteWorkflow', { workflowId, expectedRevision }, fallback);
}
