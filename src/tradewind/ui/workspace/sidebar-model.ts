import type { WorkflowSidebarItem, WorkflowType } from './workspace-types';

function withDraft(items: readonly WorkflowSidebarItem[], draft?: WorkflowSidebarItem) {
  return draft ? [draft, ...items.filter(item => item.workflowId !== draft.workflowId)] : [...items];
}

export function visibleWorkflows(
  items: readonly WorkflowSidebarItem[], type: WorkflowType, query: string, draft?: WorkflowSidebarItem,
): WorkflowSidebarItem[] {
  const search = query.trim().toLocaleLowerCase();
  return withDraft(items, draft).filter(item => (item.workflowType ?? 'strict') === type
    && (!search || `${item.name} ${item.workflowId}`.toLocaleLowerCase().includes(search)));
}

export function workflowTypeCounts(items: readonly WorkflowSidebarItem[], draft?: WorkflowSidebarItem) {
  const counts = { strict: 0, handoff: 0 };
  for (const item of withDraft(items, draft)) counts[item.workflowType ?? 'strict'] += 1;
  return counts;
}

export function activeWorkflowRuns<T extends { status: string }>(runs: readonly T[]): T[] {
  return runs.filter(run => ['queued', 'running', 'waiting', 'paused'].includes(run.status));
}
