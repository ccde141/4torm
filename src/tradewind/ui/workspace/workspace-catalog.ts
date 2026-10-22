import type { CollaborationProbeItem } from '../../../api/collaboration';
import type { WorkflowSummary } from '../workflow-client';
import type { WorkflowSidebarItem, WorkflowType } from './workspace-types';

type CatalogItem = WorkflowSummary & { orchestration?: WorkflowType };
export interface WorkspaceDraft {
  workflowId: string;
  name: string;
  nodeCount: number;
  revision: string | null;
  orchestration: WorkflowType;
}

export function selectWorkspaceWorkflow(
  items: CatalogItem[], type: WorkflowType, remembered?: string,
): string | null {
  const matches = items.filter(item => (item.orchestration ?? 'strict') === type);
  return matches.find(item => item.workflowId === remembered)?.workflowId ?? matches[0]?.workflowId ?? null;
}

export function mergeWorkspaceCatalog(
  items: CatalogItem[], draft: WorkspaceDraft, probes: CollaborationProbeItem[],
): WorkflowSidebarItem[] {
  const result: WorkflowSidebarItem[] = items.map(item => ({ ...item, workflowType: item.orchestration ?? 'strict' }));
  const current = result.find(item => item.workflowId === draft.workflowId);
  if (current) Object.assign(current, { name: draft.name, nodeCount: draft.nodeCount });
  else if (draft.workflowId !== 'untitled') result.unshift({
    ...draft, revision: draft.revision ?? '', updatedAt: '', workflowType: draft.orchestration, isDraft: true,
  });
  for (const item of result) {
    const fact = probes.find(probe => !probe.parentOperationId && probe.operationId === item.workflowId);
    if (!fact || fact.status === 'idle') continue;
    const attention = [fact, ...probes.filter(probe => probe.parentOperationId === item.workflowId)]
      .find(needsHumanInput);
    Object.assign(item, { status: fact.status, runId: fact.runId,
      needsAttention: Boolean(attention), activity: attention?.waitingReason ?? fact.waitingReason ?? fact.errorMessage });
  }
  return result;
}

function needsHumanInput(item: CollaborationProbeItem): boolean {
  if (item.status !== 'waiting') return false;
  return item.phase === 'human-gate' || item.phase === 'agent-paused'
    || Boolean(item.phase?.startsWith('meeting-'));
}
