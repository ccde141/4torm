/**
 * 气旋工作室（Cyclone）数据结构
 *
 * 气旋 = 季风会话 + 对流会议室的组合版，不是新引擎、无常驻 runner。
 * 工位（Seat）= 角色提示词 + 绑定框架内 agent + 一个后端持久化的私聊会话。
 * 群聊（Room）= 同一工作室下随时建/删的讨论场。
 *
 * 依赖边界：本模块只 import shared/，不 import conversation/ 或 convection/。
 * 会话结构与对流的 session.ts 分开维护。
 *
 * 存储布局：
 *   data/cyclone/{workshopId}/
 *     meta.json            WorkshopData（工位/群聊 id 列表 + 元信息）
 *     workspace/           共享工作区（所有工位 + 群聊共用）
 *     seats/{seatId}.json  SeatData（角色提示词 + 绑定 agentId + 私聊历史）
 *     rooms/{roomId}.json  RoomData
 *     bak/                 /reset /compact 归档
 */

import type { ContextMessage } from '../shared/types';
import type { ToolRegistrationProposal } from '../shared/tool-registration';
// 本模块作为气旋类型的入口，转出 ContextMessage 供 store 等同目录模块复用
export type { ContextMessage };

export interface SeatContextMessage extends ContextMessage {
  compactionId?: string;
  kind?: 'dispatch-receipt';
  dispatchId?: string;
  /** Stable identity of the accepted private-chat input, shared with its live activity. */
  inputMessageId?: string;
  /** 本轮原生思考流，仅供重载展示；LLM 请求仍只映射 ContextMessage 标准字段。 */
  reasoning?: string;
}

export type CycloneInputIdentity = Pick<SeatContextMessage, 'inputMessageId' | 'dispatchId'>;

/** 工位职责名片默认值（空 duty 兜底，借信风 DEFAULT_ROLE 同款语义） */
export const DEFAULT_DUTY = '补位协作者，可处理任意交办事务。专业事务请交给对应专业工位。';

/** 最近模型调用的实际用量（provider 可能不返回）。 */
export interface CycloneTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 会话压缩与归档状态。 */
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
  /** 本工位的工作室内协作工具策略；缺省沿用全开，不修改池中 Agent。 */
  collaboration?: import('./seat-collaboration.js').SeatCollaborationPolicy;
  /** 配置与绑定变更的元数据，随工位主文件一同原子提交。旧工位可缺省。 */
  history?: import('./seat-history.js').SeatHistoryRecord[];
  /** 已随成功模型请求提供的接续提醒；与工位文件一同提交，旧工位可缺省。 */
  historySeen?: { configurationId?: string; roomConfigurationId?: string; compactedAt?: string };
  /** 私聊会话历史（= 该工位的 contact 收件箱） */
  messages: SeatContextMessage[];
  displayHistory?: import('./conversation-transcript.js').CycloneDisplayHistory<SeatContextMessage>;
  tokenUsage?: CycloneTokenUsage;
  modelUsage?: import('../shared/model-request-usage.js').ModelUsageProgress;
  compactState?: CycloneCompactState;
  compactionNotice?: import('../shared/compaction/contracts.js').CompactionNotice;
  compaction?: import('../shared/compaction/contracts.js').CompactionProgress;
  /** 本工位上次已读到的工作室公告板 updatedAt（变更注意力：晚于它的条目在下一轮标 🆕） */
  bulletinSeenAt?: number;
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
    /** register_tool 的原始确认内容；普通 ask 不含此字段 */
    toolRegistration?: ToolRegistrationProposal;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * 工作室（Workshop）：一个工作区容器。
 * 挂载多个工位会话、多个群聊会话和一个共享 workspace。
 */
export interface WorkshopData {
  id: string;
  title: string;
  /** 会长 agent id（工作室级，创建时指定，不随机；场外私聊参谋 + 压缩整理）。空 = 未设会长 */
  chairAgentId?: string;
  /** 工位 id 列表（顺序即创建顺序） */
  seatIds: string[];
  /** 群聊 id 列表 */
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
export type RoomMessageSegment =
  | { kind: 'compaction'; id: string; summary: string; reasoningOffset?: number }
  | { kind: 'text'; content: string }
  | { kind: 'tools'; tools: Array<{ tool: string; args: Record<string, unknown>; result?: string;
      toolImages?: import('../shared/types.js').ToolImageRef[]; status: 'running' | 'success' | 'error' }> }
  | { kind: 'dispatch'; dispatchId: string };

export interface RoomMessage {
  executionStatus?: 'running' | 'failed' | 'stopped';
  executionError?: string;
  compactionId?: string;
  /** 稳定消息 ID；旧数据可缺省。 */
  id?: string;
  /** Agent 发言所属工位轮次，供异步派发卡锚定。 */
  turnId?: string;
  /** 人类发起的完整群聊轮次序号。 */
  roundSeq?: number;
  /** 发言者显示名（工位 title 或「人类」） */
  speaker: string;
  content: string;
  /** Active participant context after in-loop compaction; display content and tools stay intact. */
  modelContent?: string;
  timestamp: number;
  /** 工位回复的原始 LLM 输出（含标签），前端解析渲染用 */
  rawContent?: string;
  /** 本轮原生思考流（不进 LLM 上下文，仅存盘供重载展示） */
  reasoning?: string;
  /** 外置思考流对应的稳定消息 ID；旧数据可继续内联 reasoning。 */
  reasoningRef?: string;
  /** 外置内容校验值，也用于避免每次保存重复写入大文件。 */
  reasoningHash?: string;
  /** 本轮工具调用记录 */
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string;
    toolImages?: import('../shared/types.js').ToolImageRef[] }>;
  /** 可选展示分段；旧消息缺省时继续使用 content/toolCalls。 */
  segments?: RoomMessageSegment[];
  /** 时间线中的特殊系统对象。 */
  kind?: 'dispatch-result' | 'membership';
  /** 特殊系统对象关联的异步派发。 */
  dispatchId?: string;
  /** 成员变更关联的工位。 */
  seatId?: string;
  /** 成员变更方向。 */
  membershipAction?: 'joined' | 'left';
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
  publicDisplayHistory?: import('./conversation-transcript.js').CycloneDisplayHistory<RoomMessage>;
  /** Received progress at a committed compaction boundary, separate from public delivery. */
  publicExecutionDraft?: RoomMessage;
  /**
   * 会长私聊历史（对齐对流 SessionData：会长信息与群聊信息同文件、不同字段）。
   * 会长是本会议的场外参谋——纯文本、零工具，只读本 room 的会议快照。
   * 按 room 隔离，换会议不串台。
   */
  chairMessages?: SeatContextMessage[];
  chairDisplayHistory?: import('./conversation-transcript.js').CycloneDisplayHistory<SeatContextMessage>;
  /** Exact compacted chair context; public and private source records are retained separately. */
  chairActiveContext?: ContextMessage[];
  chairContextRawCount?: number;
  chairContextPublicVersion?: number;
  chairContextPublicAnchor?: { timestamp: number; hash: string };
  /** Exact prior model-input estimate anchors growth from new public/private records. */
  chairRequestEstimate?: number;
  /** 会长私聊累计 token 用量 */
  chairTokenUsage?: CycloneTokenUsage;
  chairModelUsage?: import('../shared/model-request-usage.js').ModelUsageProgress;
  tokenUsage?: CycloneTokenUsage;
  modelUsage?: import('../shared/model-request-usage.js').ModelUsageProgress;
  /** 群聊最近一次模型调用输入用量，供界面展示；tokenUsage 保留本轮最大值。 */
  publicLatestTokenUsage?: CycloneTokenUsage;
  /** 本轮任一群聊模型未报告用量时，聚合值不完整。 */
  publicUsageIncomplete?: boolean;
  compactState?: CycloneCompactState;
  compactionNotice?: import('../shared/compaction/contracts.js').CompactionNotice;
  chairCompactionNotice?: import('../shared/compaction/contracts.js').CompactionNotice;
  compaction?: import('../shared/compaction/contracts.js').CompactionProgress;
  chairCompaction?: import('../shared/compaction/contracts.js').CompactionProgress;
  /** 公共上下文代次；reset 后旧代次的异步派发不再进入当前讨论。 */
  dispatchContextVersion?: number;
  /** 已完整结束的人类发言轮次；中止轮次不递增。 */
  completedRoundSeq?: number;
  createdAt: string;
  updatedAt: string;
}
