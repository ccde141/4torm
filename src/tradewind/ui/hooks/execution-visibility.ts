export interface ExecutionIdentity {
  workflowId: string | null;
  executionId: string | null;
}

export function belongsToExecution(
  value: { workflowId?: unknown; executionId?: unknown }, identity: ExecutionIdentity,
): boolean {
  return typeof value.workflowId === 'string' && typeof value.executionId === 'string'
    && value.workflowId === identity.workflowId && value.executionId === identity.executionId;
}

export function visibleNodeStatuses<T>(
  snapshot: { running: boolean; workflowId?: unknown; executionId?: unknown; nodes?: Record<string, T> },
  editorWorkflowId: string | null,
  identity: ExecutionIdentity,
): Record<string, T> {
  if (!snapshot.running || editorWorkflowId !== identity.workflowId
    || !belongsToExecution(snapshot, identity)) return {};
  return snapshot.nodes ?? {};
}
