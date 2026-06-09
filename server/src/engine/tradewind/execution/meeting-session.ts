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

// ── 数据结构 ──────────────────────────────────────────────────

export interface MeetingMessage {
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string }>;
  /** 入会摘要流式过程中为 true；定稿后为 false / undefined */
  streaming?: boolean;
}

/** 会议参与者（节点维度，非 Agent 实体维度） */
export interface MeetingParticipant {
  nodeId: string;
  agentId: string;
  label: string;
}

export interface MeetingSessionData {
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
  /** 会长私聊历史 */
  chairMessages: ContextMessage[];
  /** 当前轮次 */
  round: number;
  /** 是否正在处理一轮 speak（轮次锁） */
  busy: boolean;
  /**
   * 会议阶段：
   * - opening: 入会摘要阶段（信封注入 + 全员摘要发言）
   * - discussion: 讨论阶段（人类主导 speak/chair/end）
   */
  phase: 'opening' | 'discussion';
  /** 当前正在流式产出的消息（面板关了再开时 replay 用） */
  streamingCurrent?: { speaker: string; content: string };
}

// ── 工厂 ──────────────────────────────────────────────────────

export interface CreateMeetingOpts {
  nodeId: string;
  meetingLabel: string;
  chairAgentId: string;
  participants: MeetingParticipant[];
  topic: string;
}

export function createMeetingSession(opts: CreateMeetingOpts): MeetingSessionData {
  return {
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
  };
}
