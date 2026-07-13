/**
 * 信风统一 SSE 推送（unified stream）
 *
 * 解决浏览器同域 6 连接上限问题。
 * 所有节点（agent / meeting）的事件通过一条 SSE 连接推送，
 * 每条事件附加 { scope, nodeId } 字段，前端按 nodeId 分发。
 */

import type { ServerResponse } from 'http';

const clients = new Set<ServerResponse>();

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
  if (clients.size === 0) return;
  const data = `data: ${JSON.stringify({ ...ev, scope, nodeId })}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch {}
  }
}
