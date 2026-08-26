import type { WorkflowGraph } from '../types';

interface SaveWorkflowInput {
  workflowId: string;
  name: string;
  graph: WorkflowGraph;
}

async function requireOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  const message = typeof body?.error === 'string' && body.error.trim()
    ? body.error
    : `${fallback} (HTTP ${response.status})`;
  throw new Error(message);
}

export async function saveWorkflow(input: SaveWorkflowInput, fallback = '保存工作流失败'): Promise<void> {
  const response = await fetch('/api/tradewind/workflow/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await requireOk(response, fallback);
}

export async function openWorkflowWorkspace(workflowId: string, fallback = '打开工作流工作区失败'): Promise<void> {
  const response = await fetch(
    `/api/tradewind/workflow/${encodeURIComponent(workflowId)}/open-workspace`,
    { method: 'POST' },
  );
  await requireOk(response, fallback);
}

export async function deleteWorkflow(workflowId: string, fallback = '删除工作流失败'): Promise<void> {
  const response = await fetch(`/api/tradewind/workflow/${encodeURIComponent(workflowId)}`, {
    method: 'DELETE',
  });
  await requireOk(response, fallback);
}
