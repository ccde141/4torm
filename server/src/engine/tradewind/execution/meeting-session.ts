/**
 * 信风 Meeting Session（纯内存态，从对流 session.ts 复制解耦）
 *
 * 与对流的差异：
 * - 无文件持久化（生命周期绑定 execution，结束后由 archive 归档）
 * - 无 index / list / delete / rename
 * - 无并发锁（orchestrator 层保证单线程访问）
 * - workspace 指向 runDir 下的 meeting workspace
 *
 * 信风独立副本，可自主演进。
 */

import type { ContextMessage } from '../../shared/types';
import { TokenUsageRecorder } from './token-usage.js';
import type { CompactionProgress } from '../../shared/compaction/index.js';

// ── 数据结构 ──────────────────────────────────────────────────

export interface MeetingMessage {
  compactionId?: string;
  compactions?: MeetingTurnCompaction[];
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  reasoning?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string; meta?: unknown;
    toolImages?: import('../../shared/types.js').ToolImageRef[] }>;
  /** 入会摘要流式过程中为 true；定稿后为 false / undefined */
  streaming?: boolean;
  /** true=该轮无有效回复（模型空回复），前端以灰字显式呈现 */
  noReply?: boolean;
}

export interface MeetingTurnCompaction {
  id: string;
  summary: string;
  toolOffset: number;
  textOffset: number;
  reasoningOffset: number;
}

export interface MeetingChairMessage extends ContextMessage {
  compactionId?: string;
}

/** 会议参与者（节点维度，非 Agent 实体维度） */
export interface MeetingParticipant {
  nodeId: string;
  agentId: string;
  label: string;
}

export interface MeetingSessionData {
  executionId?: string;
  workflowId?: string;
  /** 会议节点 ID */
  nodeId: string;
  /** 会议节点 label（显示名，用于 prompt） */
  meetingLabel: string;
  /** 会长 Agent 实体 ID */
  chairAgentId: string;
  /** 参与者列表（节点维度，用 label 区分身份） */
  participants: MeetingParticipant[];
  /** 话题（从上游信封内容提取） */
  topic: string;
  /** 公共消息历史 */
  publicMessages: MeetingMessage[];
  /** Full display prefix; publicMessages remains the bounded model-active history. */
  publicDisplayHistory?: MeetingMessage[];
  publicDisplayContextCount?: number;
  /** 会长私聊历史 */
  chairMessages: MeetingChairMessage[];
  /** Exact private model context after compaction, independent of public meeting records. */
  chairActiveContext?: ContextMessage[];
  chairContextRawCount?: number;
  chairContextPublicAnchor?: { timestamp: number; content: string };
  /** 当前轮次 */
  round: number;
  /** 是否正在处理一轮 speak（轮次锁） */
  busy: boolean;
  /**
   * 会议阶段：
   * - opening: 入会摘要阶段（信封注入 + 全员摘要发言）
   * - discussion: 讨论阶段（人类主导 speak/chair/end）
   * - ended: 会议已结束（只读历史 + 会长私聊仍可用）
   */
  phase: 'opening' | 'discussion' | 'ending' | 'ended';
  /** 当前正在流式产出的消息（面板关了再开时 replay 用） */
  streamingCurrent?: { speaker: string; content: string; reasoning?: string;
    toolCount?: number; toolCalls?: MeetingMessage['toolCalls']; compactions?: MeetingTurnCompaction[] };
  /** Provider-reported usage for every model call in this meeting activation. */
  usageRecorder: TokenUsageRecorder;
  compactionNotice?: string;
  compactions?: { public?: CompactionProgress; chair?: CompactionProgress };
}

// ── 工厂 ──────────────────────────────────────────────────────

export interface CreateMeetingOpts {
  executionId?: string;
  workflowId?: string;
  nodeId: string;
  meetingLabel: string;
  chairAgentId: string;
  participants: MeetingParticipant[];
  topic: string;
  usageFile?: string;
}

export function createMeetingSession(opts: CreateMeetingOpts): MeetingSessionData {
  return {
    executionId: opts.executionId,
    workflowId: opts.workflowId,
    nodeId: opts.nodeId,
    meetingLabel: opts.meetingLabel,
    chairAgentId: opts.chairAgentId,
    participants: opts.participants,
    topic: opts.topic,
    publicMessages: [],
    chairMessages: [],
    round: 0,
    busy: false,
    phase: 'opening',
    usageRecorder: new TokenUsageRecorder(opts.usageFile),
  };
}
