import type { ResolvedOutputBudget } from '../../../engine/collaboration/contracts.js';
import type { WorkflowSpec } from '../domain/workflow-spec.js';
import type { WorkflowDefinition } from './workflow-store.js';

export interface TradewindDesignPort {
  listAgentSummaries(): Promise<Array<{ id: string; name: string; model: string }>>;
  listAgents(budget?: ResolvedOutputBudget): Promise<string>;
  createWorkflow(spec: WorkflowSpec): Promise<string>;
  listWorkflows(workflowId?: string, budget?: ResolvedOutputBudget): Promise<string>;
  readWorkflow(workflowId: string): Promise<WorkflowDefinition>;
  updateWorkflow(workflowId: string, spec: WorkflowSpec, expectedRevision: string): Promise<string>;
}
