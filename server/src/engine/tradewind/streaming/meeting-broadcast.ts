/**
 * 会议室统一事件广播
 *
 * 持有一个全局连接池（nodeId → Set<ServerResponse>），
 * 所有会议室阶段（opening / discussion / chair / summary / compact）统一通过此模块
 * 向已连接的 SSE 客户端推送事件，替代碎片化的轮询 + 短 SSE 通道。
 */

import type { ServerResponse } from 'node:http';
import { pushUnified } from './unified-stream';

export type MeetingBroadcastEvent =
  | { type: 'connected'; phase: string; round: number; messages: unknown[]; chairMessages: unknown[]; participants: unknown[]; configuredParticipants: unknown[] }
  | { type: 'agent-start'; label: string }
  | { type: 'token'; label: string; chunk: string }
  | { type: 'tool-call'; label: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; label: string; tool: string; result: string; meta?: unknown }
  | { type: 'heartbeat'; label: string; phase?: string; elapsed?: number }
  | { type: 'contact-start'; label: string; target: string }
  | { type: 'contact-done'; label: string; target: string; result: string; ok: boolean }
  | { type: 'agent-done'; label: string; content: string; rawContent?: string; toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string; meta?: unknown }>; noReply?: boolean }
  | { type: 'round-done'; messages: unknown[]; compacted?: boolean }
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-done'; content: string }
  | { type: 'minutes-done'; content: string }
  | { type: 'summary-chunk'; chunk: string }
  | { type: 'summary-done'; minutes: string }
  | { type: 'phase-change'; phase: string }
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedRounds?: number; summaryLength?: number }
  | { type: 'compact-warn'; message: string }
  | { type: 'done'; messages: unknown[] }
  | { type: 'error'; message: string };

const clients = new Map<string, Set<ServerResponse>>();

export function addClient(nodeId: string, res: ServerResponse): void {
  let set = clients.get(nodeId);
  if (!set) {
    set = new Set();
    clients.set(nodeId, set);
  }
  set.add(res);
}

export function removeClient(nodeId: string, res: ServerResponse): void {
  clients.get(nodeId)?.delete(res);
}

export function clearClients(nodeId: string): void {
  clients.delete(nodeId);
}

export function broadcastToMeeting(nodeId: string, event: MeetingBroadcastEvent): void {
  // 推送到统一 SSE 流
  pushUnified('meeting', nodeId, event as unknown as Record<string, unknown>);
  // 推送到 per-node 客户端（兼容旧端点）
  const set = clients.get(nodeId);
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { /* client disconnected */ }
  }
}
