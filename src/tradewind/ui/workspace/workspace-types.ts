import type { WorkflowSummary } from '../workflow-client';

export type WorkflowType = 'strict' | 'handoff';
export type WorkspaceTab = 'design' | 'run' | 'records';
export type WorkflowRunStatus = 'queued' | 'running' | 'waiting' | 'paused'
  | 'completed' | 'aborted' | 'failed' | 'crashed';

export interface WorkflowSidebarItem extends WorkflowSummary {
  /** Missing on legacy definitions; strict dependency remains their behavior. */
  workflowType?: WorkflowType;
  status?: WorkflowRunStatus;
  runId?: string;
  /** A live human gate, paused node, or meeting awaiting human input. */
  needsAttention?: boolean;
  activity?: string;
  isDraft?: boolean;
}

export interface WorkflowRunItem {
  workflowId: string;
  name: string;
  status: WorkflowRunStatus;
  workflowType?: WorkflowType;
  detail?: string;
  startedAt?: string;
}
