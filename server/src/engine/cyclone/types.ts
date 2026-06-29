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
// 本模块作为气旋类型的入口，转出 ContextMessage 供 store 等同目录模块复用
export type { ContextMessage };

/** 工位职责名片默认值（空 duty 兜底，借信风 DEFAULT_ROLE 同款语义） */
export const DEFAULT_DUTY = '补位协作者，可处理任意交办事务。专业事务请交给对应专业工位。';

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
  /** 上次压缩/重置时间（ISO 字符串） */
  lastCompactAt?: string;
}

/**
 * 工位（Seat）：节点式岗位，不是 agent 本身。
 * 寻址单位是 seatId，不是 agentId（多工位可绑同一 agent，互不串味）。
 */
export interface SeatData {
  id: string;
  /** 工位显示名（如「架构师」「测试」） */
  title: string;
  /** 角色提示词（默认叠加在绑定 agent 自身 rolePrompt 之上；overrideAgentRole=true 时顶替之） */
  rolePrompt: string;
  /**
   * 职责名片（一句话）：自己注入进自己的 prompt + 进 contact 名册供同事识别。
   * 工位级，与 title 对应。空 = 注入时用 DEFAULT_DUTY 兜底。
   */
  duty?: string;
  /** 覆盖开关：true = 工位 rolePrompt 顶替 agent 自身人设段；false/缺省 = 叠加 */
  overrideAgentRole?: boolean;
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
  /** 会长 agent id（工作室级，创建时指定，不随机；场外私聊参谋 + 压缩整理）。空 = 未设会长 */
  chairAgentId?: string;
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

/** 群聊一条公共消息（发言者 = 工位 title 或「人类」） */
export interface RoomMessage {
  /** 发言者显示名（工位 title 或「人类」） */
  speaker: string;
  content: string;
  timestamp: number;
  /** 工位回复的原始 LLM 输出（含标签），前端解析渲染用 */
  rawContent?: string;
  /** 本轮工具调用记录 */
  toolCalls?: Array<{ tool: string; args: Record<string, string>; result: string }>;
}

/**
 * 群聊/会议室（Room）：同一工作室下的讨论场。
 * 对齐对流：人发一句 → 在场工位依次回一句，公共上下文快照。
 * 讨论场剥离 ask/delegate（不阻塞串行循环），保留真实工具 + contact。
 * 工位在群里的发言只落 publicMessages，不落工位私聊会话。
 */
/** 群聊模式：build = 全套工具可写工作区；plan = 只读工具 + contact，砍写工具（按 dangerous 过滤） */
export type RoomMode = 'build' | 'plan';

/** 工位入会发言行为：summary = 调 LLM 总结私聊近况；intro = 基于角色简短自我介绍；none = 静默入会 */
export type JoinBehavior = 'summary' | 'intro' | 'none';

export interface RoomData {
  id: string;
  title: string;
  /** 话题 */
  topic: string;
  /** 群聊模式（默认 build）。plan 下工位只能用只读工具 + contact */
  mode?: RoomMode;
  /** 在场工位 id 列表（顺序即发言顺序） */
  participantSeatIds: string[];
  /** 公共消息历史 */
  publicMessages: RoomMessage[];
  /**
   * 会长私聊历史（对齐对流 SessionData：会长信息与群聊信息同文件、不同字段）。
   * 会长是本会议的场外参谋——纯文本、零工具，只读本 room 的会议快照。
   * 按 room 隔离，换会议不串台。
   */
  chairMessages?: ContextMessage[];
  /** 会长私聊累计 token 用量 */
  chairTokenUsage?: CycloneTokenUsage;
  tokenUsage?: CycloneTokenUsage;
  compactState?: CycloneCompactState;
  createdAt: string;
  updatedAt: string;
}
