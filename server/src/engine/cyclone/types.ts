/**
 * 气旋工作室（Cyclone）数据结构
 *
 * 气旋 = 季风会话 + 对流会议室的组合版，不是新引擎、无常驻 runner。
 * 工位（Seat）= 角色提示词 + 绑定框架内 agent + 一个后端持久化的私聊会话。
 * 群聊（Room，Phase 1）= 同一工作室下随时建/删的讨论场。
 *
 * 边界铁律：本模块只 import shared/，绝不 import conversation/ 或 convection/。
 * 哪怕结构与对流的 session.ts 相似，也各写一份，零交叉代码。
 *
 * 存储布局：
 *   data/cyclone/{workshopId}/
 *     meta.json            WorkshopData（工位/群聊 id 列表 + 元信息）
 *     workspace/           共享工作区（所有工位 + 群聊共用）
 *     seats/{seatId}.json  SeatData（角色提示词 + 绑定 agentId + 私聊历史）
 *     rooms/{roomId}.json  RoomData（Phase 1）
 *     bak/                 /reset /compact 归档（Phase 3）
 */

import type { ContextMessage } from '../shared/types';

/** 累计 token 用量（真实 API 返回值，provider 可能不返回） */
export interface CycloneTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 压缩状态（Phase 3 用，先占位） */
export interface CycloneCompactState {
  disabled: boolean;
  archiveSeq: number;
}

/**
 * 工位（Seat）：节点式岗位，不是 agent 本身。
 * 寻址单位是 seatId，不是 agentId（多工位可绑同一 agent，互不串味）。
 */
export interface SeatData {
  id: string;
  /** 工位显示名（如「架构师」「测试」） */
  title: string;
  /** 角色提示词（叠加在绑定 agent 自身 rolePrompt 之上） */
  rolePrompt: string;
  /** 绑定的框架内 agent 实体 id（data/agents/registry.json） */
  agentId: string;
  /** 私聊会话历史（= 该工位的 contact 收件箱） */
  messages: ContextMessage[];
  tokenUsage?: CycloneTokenUsage;
  compactState?: CycloneCompactState;
  /**
   * ask 挂起态（工位向人类提问，等回复后 resume）。
   * 因工位无常驻 runner，挂起态必须落文件，不能存内存。
   * messages 已含挂起时刻的完整快照（含 assistant tool_calls），resume 时回填配对结果。
   */
  pending?: {
    question: string;
    options?: string[];
    /** 原生模式触发挂起的 ask tool_call id；文本模式为 undefined */
    pendingToolCallId?: string;
    /** 挂起时是否处于原生模式（resume 走对应回填方式） */
    native: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * 工作室（Workshop）：一个工作区容器。
 * 挂载多个工位会话 + 多个群聊会话（Phase 1）+ 一个共享 workspace。
 */
export interface WorkshopData {
  id: string;
  title: string;
  /** 工位 id 列表（顺序即创建顺序） */
  seatIds: string[];
  /** 群聊 id 列表（Phase 1） */
  roomIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** 工作室列表摘要（前端列表用，不含完整会话） */
export interface WorkshopSummary {
  id: string;
  title: string;
  seatCount: number;
  roomCount: number;
  createdAt: string;
  updatedAt: string;
}
