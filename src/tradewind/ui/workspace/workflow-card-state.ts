import type { WorkflowSidebarItem } from './workspace-types';

export type WorkflowCardState = 'running' | 'attention' | 'error' | 'completed';
export type AcknowledgedWorkflowRuns = Readonly<Record<string, string>>;

export const WORKFLOW_READ_RUNS_KEY = '4torm.tradewind.workflow-read-runs';

export function workflowCardState(
  item: WorkflowSidebarItem, acknowledged: AcknowledgedWorkflowRuns,
): WorkflowCardState | undefined {
  if (item.status === 'failed' || item.status === 'crashed') return 'error';
  if (item.status === 'completed') {
    return item.runId && acknowledged[item.workflowId] === item.runId ? undefined : 'completed';
  }
  if (item.status === 'paused' || (item.needsAttention && item.status !== 'aborted')) return 'attention';
  if (item.status && ['queued', 'running', 'waiting'].includes(item.status)) return 'running';
  return undefined;
}

export function acknowledgeWorkflowRun(
  acknowledged: AcknowledgedWorkflowRuns, item: WorkflowSidebarItem,
): AcknowledgedWorkflowRuns {
  if (item.status !== 'completed' || !item.runId || acknowledged[item.workflowId] === item.runId) return acknowledged;
  return { ...acknowledged, [item.workflowId]: item.runId };
}

export function readAcknowledgedWorkflowRuns(storage?: Pick<Storage, 'getItem'>): AcknowledgedWorkflowRuns {
  try {
    const value: unknown = JSON.parse(storage?.getItem(WORKFLOW_READ_RUNS_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, runId]) => typeof runId === 'string'));
  } catch { return {}; }
}
