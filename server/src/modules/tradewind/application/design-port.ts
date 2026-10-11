import type { ResolvedOutputBudget } from '../../../engine/collaboration/contracts.js';
import type { WorkflowSpec } from '../domain/workflow-spec.js';

export interface TradewindDesignPort {
  listAgentSummaries(): Promise<Array<{ id: string; name: string; model: string }>>;
  listAgents(budget?: ResolvedOutputBudget): Promise<string>;
  createWorkflow(spec: WorkflowSpec): Promise<string>;
  listWorkflows(workflowId?: string, budget?: ResolvedOutputBudget): Promise<string>;
  updateWorkflow(workflowId: string, spec: WorkflowSpec, expectedRevision: string): Promise<string>;
}
