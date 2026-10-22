/**
 * 会议室统一事件广播
 *
 * 持有一个全局连接池（nodeId → Set<ServerResponse>），
 * 所有会议室阶段（opening / discussion / chair / summary / compact）统一通过此模块
 * 向已连接的 SSE 客户端推送事件，替代碎片化的轮询 + 短 SSE 通道。
 */

import type { ServerResponse } from 'node:http';
import type { FrameworkErrorKind } from '../../shared/framework-error.js';
import { pushUnified } from './unified-stream';
import type { TokenUsage } from '../../shared/llm-bridge.js';
import type { TokenUsageProgress } from '../execution/token-usage.js';
import { ExecutionRegistry } from '../execution/execution-registry.js';
import type { CompactionProgress } from '../../shared/compaction/index.js';

export type MeetingBroadcastEvent =
  | { type: 'connected'; phase: string; round: number; runId?: string; messages: unknown[]; chairMessages: unknown[]; participants: unknown[]; configuredParticipants: unknown[]; tokenUsage?: TokenUsageProgress; compactionNotice?: string; compactions?: { public?: CompactionProgress; chair?: CompactionProgress } }
  | { type: 'round-start'; runId: string; startedAt: string }
  | { type: 'agent-start'; label: string }
  | { type: 'token'; label: string; chunk: string }
  | { type: 'reasoning'; label: string; chunk: string }
  | { type: 'usage'; usage: TokenUsage | null; tokenUsage: TokenUsageProgress; label?: string }
  | { type: 'tool-call'; label: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool-result'; label: string; tool: string; result: string; meta?: unknown }
  | { type: 'heartbeat'; label: string; phase?: string; elapsed?: number }
  | { type: 'contact-start'; label: string; target: string }
  | { type: 'contact-done'; label: string; target: string; result: string; ok: boolean }
  | { type: 'agent-done'; label: string; content: string; rawContent?: string; reasoning?: string; toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string; meta?: unknown }>; noReply?: boolean }
  | { type: 'round-done'; messages: unknown[]; compacted?: boolean }
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-reasoning'; chunk: string }
  | { type: 'chair-done'; content: string; reasoningContent?: string }
  | { type: 'minutes-done'; content: string }
  | { type: 'summary-chunk'; chunk: string }
  | { type: 'summary-done'; minutes: string }
  | { type: 'phase-change'; phase: string }
  | (CompactionProgress & { target?: 'public' | 'chair' })
  | { type: 'compact-warn'; message: string }
  | { type: 'compaction-notice'; message: string }
  | { type: 'compaction-notice-clear' }
  | { type: 'history-updated'; messages: unknown[]; chairMessages: unknown[]; target?: 'public' | 'chair' }
  | { type: 'done'; messages: unknown[] }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind; target?: 'public' | 'chair' };

const clients = new Map<string, Set<ServerResponse>>();
const listeners = new Map<string, Set<(event: MeetingBroadcastEvent) => void>>();
const identities = new ExecutionRegistry<{ workflowId: string; executionId: string }>(value => value.executionId);

function meetingKey(nodeId: string, executionId?: string): string {
  return JSON.stringify([executionId ?? identities.get(nodeId)?.executionId ?? '__legacy__', nodeId]);
}

export function setMeetingIdentity(nodeId: string, workflowId: string, executionId: string): void {
  identities.set(nodeId, { workflowId, executionId });
}

export function clearMeetingIdentity(nodeId: string, executionId?: string): void {
  const key = meetingKey(nodeId, executionId);
  identities.delete(nodeId, executionId);
  clients.delete(key);
  listeners.delete(key);
}

export function subscribeMeeting(
  nodeId: string, listener: (event: MeetingBroadcastEvent) => void, executionId?: string,
): () => void {
  const key = meetingKey(nodeId, executionId);
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(key);
  };
}

export function addClient(nodeId: string, res: ServerResponse, executionId?: string): void {
  const key = meetingKey(nodeId, executionId);
  const set = clients.get(key) ?? new Set();
  set.add(res);
  clients.set(key, set);
}

export function removeClient(nodeId: string, res: ServerResponse, executionId?: string): void {
  const key = meetingKey(nodeId, executionId);
  const set = clients.get(key);
  set?.delete(res);
  if (!set?.size) clients.delete(key);
}

export function clearClients(nodeId: string, executionId?: string): void {
  const key = meetingKey(nodeId, executionId);
  clients.delete(key);
  listeners.delete(key);
}

export function broadcastToMeeting(nodeId: string, event: MeetingBroadcastEvent, executionId?: string): void {
  const identity = identities.get(nodeId, executionId);
  // A late callback after execution cleanup must not become an identity-free node event.
  if (executionId && !identity) return;
  const key = meetingKey(nodeId, executionId);
  const fullEvent = { ...event, ...identity };
  pushUnified('meeting', nodeId, fullEvent);
  for (const listener of listeners.get(key) ?? []) {
    try { listener(fullEvent); } catch { listeners.get(key)?.delete(listener); }
  }
  const data = `data: ${JSON.stringify(fullEvent)}\n\n`;
  for (const res of clients.get(key) ?? []) {
    try { res.write(data); } catch { clients.get(key)?.delete(res); }
  }
}
