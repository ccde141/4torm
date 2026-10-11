/**
 * 信风统一 SSE 推送（unified stream）
 *
 * 让信风节点共享同一条可按 nodeId 分发的事件订阅。
 * 所有节点（agent / meeting）的事件通过一条 SSE 连接推送，
 * 每条事件附加 { scope, nodeId } 字段，前端按 nodeId 分发。
 */

import type { ServerResponse } from 'http';

const clients = new Set<ServerResponse>();
const listeners = new Set<(event: Record<string, unknown>) => void>();

export function subscribeUnified(listener: (event: Record<string, unknown>) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function addUnifiedClient(res: ServerResponse): void {
  clients.add(res);
}

export function removeUnifiedClient(res: ServerResponse): void {
  clients.delete(res);
}

/**
 * 向所有 unified SSE 客户端推送事件。
 * 由 node-runner eventListener 和 meeting-broadcast 调用。
 */
export function pushUnified(scope: 'agent' | 'meeting', nodeId: string, ev: Record<string, unknown>): void {
  broadcast({ ...ev, scope, nodeId });
}

export function pushExecutionLifecycle(event: Record<string, unknown>): void {
  broadcast({ ...event, scope: 'execution' });
}

export interface WorkflowChange {
  workflowId: string;
  revision: string | null;
  change: 'created' | 'updated' | 'deleted';
}

export function pushWorkflowChange(event: WorkflowChange): void {
  broadcast({ ...event, scope: 'workflow', type: 'workflow-changed' });
}

function broadcast(event: Record<string, unknown>): void {
  if (clients.size === 0 && listeners.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch {}
  }
  for (const listener of listeners) {
    try { listener(event); } catch { listeners.delete(listener); }
  }
}
