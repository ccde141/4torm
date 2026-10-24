/**
 * 信风 Meeting 节点 HTTP 客户端
 *
 * 从 src/convection/ui/pages/ConvectionPage.tsx 复制解耦，独立演进。
 * 封装 meeting 端点的 HTTP 调用。
 *
 * 信风独立副本，可自主演进。
 */

import { backendFetch } from '../../../lib/backend-client';
import type { CompactionEvent } from '../compaction-events';
import { errorFromResponse, type FrameworkErrorKind } from '../../../api/error-contract';
import { invokeFeature } from '../../../api/collaboration';
import { requirePanelIdentity, panelReadUrl } from '../stream/panel-identity';
import type { ExecutionIdentity } from '../hooks/execution-visibility';
import type { ProviderUsage } from '../token-usage';
import type { ToolImageRef } from '../../../engine/tool-media';
import type { CurrentInputEstimate, ModelRequestUsage, ModelUsageProgress } from '../../../lib/model-usage';

export interface MeetingTokenUsage {
  modelUsage?: ModelUsageProgress;
  calls: number;
  reportedCalls: number;
  latest: ProviderUsage | null;
  total: ProviderUsage;
}

export type ToolStepStatus = 'running' | 'done' | 'error';

export interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  toolImages?: ToolImageRef[];
  status?: ToolStepStatus;
  diff?: { before?: string };
  meta?: { before?: string };
}

export interface MeetingMessage {
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  reasoning?: string;
  toolCalls?: ToolStep[];
  streaming?: boolean;
  noReply?: boolean; // true=该轮无有效回复（模型空回复），前端以灰字显式呈现
}

export interface MeetingParticipant {
  nodeId: string;
  agentId: string;
  label: string;
}

export interface MeetingChairMessage {
  role: string;
  content: string;
  reasoningContent?: string;
}

export interface MeetingStatus {
  currentInput?: { public?: CurrentInputEstimate; chair?: CurrentInputEstimate };
  nodeId: string;
  workflowId: string;
  executionId: string;
  round: number;
  busy: boolean;
  runId?: string;
  /** opening=入会摘要；discussion=讨论；ending=会议助理整理纪要；ended=会议结束 */
  phase?: 'opening' | 'discussion' | 'ending' | 'ended';
  messageCount: number;
  participants: MeetingParticipant[];
  configuredParticipants: MeetingParticipant[];
  chairAgentId: string;
  publicMessages?: MeetingMessage[];
  chairMessages?: MeetingChairMessage[];
  /** 正在流式产出的消息（面板关了再开时 replay 用） */
  streamingCurrent?: { speaker: string; content: string; reasoning?: string } | null;
  tokenUsage?: MeetingTokenUsage;
  compactionNotice?: string;
  compactions?: { public?: CompactionEvent; chair?: CompactionEvent };
}

export type MeetingBroadcastEvent =
  | { type: 'model-request'; request: ModelRequestUsage; label?: string }
  | { type: 'connected'; phase: string; round: number; runId?: string; messages: MeetingMessage[]; chairMessages: MeetingChairMessage[]; participants: MeetingParticipant[]; configuredParticipants: MeetingParticipant[]; tokenUsage?: MeetingTokenUsage; compactionNotice?: string; compactions?: MeetingStatus['compactions'] }
  | { type: 'round-start'; runId: string; startedAt: string }
  | { type: 'agent-start'; label: string }
  | { type: 'token'; label: string; chunk: string }
  | { type: 'reasoning'; label: string; chunk: string }
  | { type: 'usage'; usage: ProviderUsage | null; tokenUsage: MeetingTokenUsage; label?: string }
  | { type: 'tool-call'; label: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool-result'; label: string; tool: string; result: string; toolImages?: ToolImageRef[]; meta?: { before?: string } }
  | { type: 'heartbeat'; label: string; phase?: string; elapsed?: number }
  | { type: 'contact-start'; label: string; target: string }
  | { type: 'contact-done'; label: string; target: string; result: string; ok: boolean }
  | { type: 'agent-done'; label: string; content: string; rawContent?: string; reasoning?: string; toolCalls?: ToolStep[]; noReply?: boolean }
  | { type: 'round-done'; messages: MeetingMessage[]; compacted?: boolean }
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-reasoning'; chunk: string }
  | { type: 'chair-done'; content: string; reasoningContent?: string }
  | { type: 'minutes-done'; content: string }
  | { type: 'summary-chunk'; chunk: string }
  | { type: 'summary-done'; minutes: string }
  | { type: 'phase-change'; phase: string }
  | CompactionEvent
  | { type: 'compact-warn'; message: string }
  | { type: 'compaction-notice'; message: string }
  | { type: 'compaction-notice-clear' }
  | { type: 'history-updated'; messages: MeetingMessage[]; chairMessages: MeetingChairMessage[]; target?: 'public' | 'chair' }
  | { type: 'done'; messages: Array<{ role: string; content: string }> }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind; target?: 'public' | 'chair' };


/** 发送公共发言（fire-and-forget，事件通过 /events 流返回） */
export async function sendSpeak(
  executionId: string, nodeId: string, message: string, signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  await invokeFeature('tradewind', 'speakMeeting', { executionId, nodeId, message }, undefined, { signal });
  return { ok: true };
}

/** 发送会议助理私聊（fire-and-forget，事件通过 /events 流返回） */
export async function sendChair(
  executionId: string, nodeId: string, message: string, signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  await invokeFeature('tradewind', 'messageMeetingChair', { executionId, nodeId, message }, undefined, { signal });
  return { ok: true };
}

/** 人类结束会议 → 会议助理生成纪要 */
export function endMeeting(executionId: string, nodeId: string): Promise<{ minutes: string }> {
  return invokeFeature('tradewind', 'endMeeting', { executionId, nodeId });
}

/** 获取会议状态 */
export async function getStatus(nodeId: string, identity: ExecutionIdentity): Promise<MeetingStatus> {
  const res = await backendFetch(panelReadUrl(`/api/tradewind/meeting/${encodeURIComponent(nodeId)}/status`, identity));
  if (!res.ok) throw await errorFromResponse(res);
  return requirePanelIdentity(await res.json() as MeetingStatus, identity);
}

/** 动态加入参与者（按节点 ID） */
export function joinMeeting(
  executionId: string, nodeId: string, participantNodeId: string,
): Promise<{ participants: MeetingParticipant[] }> {
  return invokeFeature('tradewind', 'joinMeeting', { executionId, nodeId, participantNodeId });
}

/** 动态移除参与者（按节点 ID） */
export function leaveMeeting(
  executionId: string, nodeId: string, participantNodeId: string,
): Promise<{ participants: MeetingParticipant[] }> {
  return invokeFeature('tradewind', 'leaveMeeting', { executionId, nodeId, participantNodeId });
}

/** 调整参与者顺序（按节点 ID 数组） */
export function reorderMeeting(
  executionId: string, nodeId: string, order: string[],
): Promise<{ participants: MeetingParticipant[] }> {
  return invokeFeature('tradewind', 'reorderMeeting', { executionId, nodeId, order });
}
