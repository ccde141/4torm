import type { ToolImageRef } from '../engine/tool-media';

/** Agent 的持久化可用状态；实时 busy 由服务端活动表覆盖。 */
export type AgentStatus = string;

/** Agent 信息 */
export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  /** 至少有一个运行实例仍然活动；仅用于展示，不参与互斥。 */
  busy?: boolean;
  /** 当前运行来源，仅由服务端运行态覆盖，不持久化。 */
  activeSurfaces?: Array<'conversation' | 'convection' | 'cyclone' | 'tradewind' | 'tide'>;
  /** 本地头像版本；图片存于 data/agents/{id}/profile/avatar.webp。 */
  avatar?: { version: number };
  model: string;
  description: string;
  config?: AgentConfig;
  /** API 列表的展示路径：软件目录内为相对路径，外部为绝对路径。 */
  workspaceDisplayPath?: string;
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
  tasksCompleted: number;
}

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 会话持久化的图片索引；二进制内容由本地附件接口管理。 */
export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface NativeContextMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  origin?: 'human' | 'framework';
  images?: ImageAttachment[];
  toolImages?: ToolImageRef[];
  reasoningContent?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
}

/** 单条消息 */
export interface ChatMessage {
  /** Display order only; model history continues to use nativeContext/toolSteps. */
  activitySequence?: ChatActivity[];
  /** Display-only observation boundaries; absent in legacy sessions. */
  reasoningBreaks?: number[];
  streamStopped?: boolean;
  inputRunId?: string;
  /** True only after a complete run is included in a saved session. */
  runCommitted?: boolean;
  inputReady?: boolean;
  inputClosed?: boolean;
  inputIncludedIds?: string[];
  humanInputs?: Array<{ id: string; content: string; runId: string; sequence: number; receivedAt: string;
    state: 'received' | 'included' | 'retained' }>;
  contextExact?: boolean;
  contextOmitted?: boolean;
  compactionNotice?: string;
  inputRecoveryError?: string;
  inputSkipped?: string[];
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  agentId?: string;
  /** 用户随消息发送的本地图片。 */
  images?: ImageAttachment[];
  toolCall?: ToolCall;
  /** 运行时类型标记（如 'compact-marker'） */
  type?: string;
  /** Successful in-turn compaction boundary; references display records without splitting the run. */
  execution?: { assistantId: string; toolOffset: number; textOffset?: number; eventOffset?: number; reasoningOffset?: number };
  /** agent 反问（ask 工具触发） */
  ask?: {
    question: string;
    options?: string[];
    answered: boolean;
    /** 产生此问题的运行标识；不参与可插话输入流。 */
    sourceRunId?: string;
    /** 人类的回复内容（answered=true 后填充） */
    reply?: string;
  };
  /**
   * 内嵌工具步骤（工具名/参数/结果/状态）。
   * 这是工具调用的唯一展示数据，需持久化用于重载渲染与跨轮次历史回灌。
   */
  toolSteps?: ToolStep[];
  /** 流式阶段标识（运行时字段，不持久化） */
  streamingPhase?: 'queued' | 'llm-waiting' | 'model-output' | 'tool-preparing' | 'tool-exec' | 'team-waiting';
  /** 当前阶段已等待秒数（运行时字段） */
  phaseElapsed?: number;
  /** 正在准备或执行的工具名（运行时字段） */
  streamingTool?: string;
  /** 原生工具参数已生成字符数（运行时字段，不包含参数正文） */
  streamingArgumentChars?: number;
  /** 服务端给出的具体运行提示（排队、兼容性警告等；运行时字段） */
  streamingStatus?: string;
  /**
   * 原生思考流（reasoning_content/reasoning/thinking）。与正文物理分开，
   * 不在 rawContent 里，故需持久化，否则重载丢失。无原生思考的模型为空。
   */
  reasoningContent?: string;
  /** 服务端返回的精确原生消息增量，用于下一轮无损回灌。 */
  nativeContext?: NativeContextMessage[];
  /**
   * 该回复是否由原生工具调用模式产生，持久化用于诊断和历史展示。
   */
  native?: boolean;
}

export interface TeamActivity {
  id: string;
  stage: 'dispatched' | 'reported' | 'injected' | 'acknowledged' | 'reviewed';
  timestamp: string;
  memberId: string;
  memberName?: string;
  runId?: string;
  reportId?: string;
  outcome?: string;
  decision?: string;
  preview?: string;
}

export type ChatActivity =
  | { kind: 'text'; content: string }
  | { kind: 'tool'; index: number }
  | { kind: 'team'; event: TeamActivity }
  | { kind: 'compact'; markerId: string; toolOffset: number; timestamp: string; reasoningOffset?: number };

/** 工具调用步骤（StructuredMessage 与流式期间共用） */
export interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  toolImages?: ToolImageRef[];
  status: 'pending' | 'running' | 'done' | 'error';
  /** UI 侧通道元数据，与独立 ToolCall 卡片保持一致。 */
  diff?: ToolCall['diff'];
  pendingAutomation?: ToolCall['pendingAutomation'];
  workflowExecution?: ToolCall['workflowExecution'];
  /**
   * delegate 专用：sub-agent 的思考流 + 子步骤 + 汇总。
   * 存在时该 step 用 DelegateCard inline 渲染，落在 toolSteps 的调用顺序里
   * （框架串行：思考流 → 按序工具含 sub-agent 卡 → 最终 content）。
   */
  delegate?: {
    delegateId: string;
    task: string;
    content: string;
    steps: Array<{ type: 'tool'; tool?: string; args?: Record<string, unknown>; result?: string; ok?: boolean; toolImages?: ToolImageRef[] }>;
    summary?: string;
    status: 'running' | 'success' | 'error';
  };
}

/** 工具调用记录 */
export interface ToolCall {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  toolImages?: ToolImageRef[];
  durationMs?: number;
  status: 'pending' | 'success' | 'error' | 'running';
  /** UI 侧通道元数据：覆盖写入时的旧内容，用于渲染真实 diff（不进 LLM 上下文） */
  diff?: { before?: string };
  /** UI 侧通道：Agent 增改潮汐任务时由服务端生成的事实快照。 */
  pendingAutomation?: {
    mode: 'created' | 'updated';
    taskId: string; name: string; schedule: string; repeatCount: number; perpetual: boolean;
    selfLoop: boolean; windowN: number; enabled: boolean; agentName: string; sandboxLevel: string;
    canWriteFiles: boolean; promptPreview: string;
  };
  /** 季风启动信风后的执行凭证；状态仍以信风服务端为准。 */
  workflowExecution?: {
    workflowId: string;
    workflowName: string;
    executionId: string;
    status: 'running';
  };
  /** delegate 子步骤 */
  steps?: Array<{ type: 'tool' | 'thought'; tool?: string; args?: Record<string, unknown>; result?: string; ok?: boolean; text?: string; toolImages?: ToolImageRef[] }>;
}

/** Agent 会话 */
export interface AgentSession {
  id: string;
  agentId: string;
  title: string;
  lastMessage?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 仪表盘统计 */
export interface DashboardStats {
  totalAgents: number;
  onlineAgents: number;
  totalSessions: number;
  activeSessions: number;
  avgResponseTime: number;
  totalToolCalls: number;
}

/** 技能元数据 */
export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  hasTools: boolean;
}

/** Agent 配置 */
export interface AgentConfig {
  masterPrompt?: string;
  rolePrompt?: string;
  compactionPrompt?: string;
  temperature?: number;
  tools?: string[];
  /** 缺省仅兼容旧数据；新配置始终保存为 selected，空数组即不启用本地工具。 */
  toolMode?: 'all' | 'selected';
  skills?: string[];
  workspace?: string;
  /** 文件工具权限；strict/relaxed 仅用于读取旧配置。 */
  sandboxLevel?: 'project' | 'unrestricted' | 'strict' | 'relaxed';
}

/** 导航项 */
export interface NavItem {
  id: string;
  label: string;
  icon: 'dashboard' | 'agents' | 'chat' | 'tools' | 'skills' | 'convection' | 'cyclone' | 'tradewind' | 'tide' | 'mcp' | 'model' | 'settings';
  badge?: number;
}

