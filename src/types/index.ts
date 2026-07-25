/** Agent 的持久化可用状态；实时 busy 由服务端活动表覆盖。 */
export type AgentStatus = string;

/**
 * 用户自定义分类标签。
 * 纯展示用，不影响任何锁定逻辑。
 */
export type AgentLabel = string;

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
  /** 用户自定义分类标签（纯展示，不影响锁） */
  label?: AgentLabel;
  model: string;
  description: string;
  config?: AgentConfig;
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
  images?: ImageAttachment[];
  reasoningContent?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
}

/** 单条消息 */
export interface ChatMessage {
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
  /** agent 反问（ask 工具触发） */
  ask?: {
    question: string;
    options?: string[];
    answered: boolean;
    /** 人类的回复内容（answered=true 后填充） */
    reply?: string;
  };
  /**
   * 内嵌工具步骤（工具名/参数/结果/状态）。
   * 这是工具调用的唯一展示数据，需持久化用于重载渲染与跨轮次历史回灌。
   */
  toolSteps?: ToolStep[];
  /** 流式阶段标识（运行时字段，不持久化） */
  streamingPhase?: 'queued' | 'llm-waiting' | 'model-output' | 'tool-preparing' | 'tool-exec';
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

/** 工具调用步骤（StructuredMessage 与流式期间共用） */
export interface ToolStep {
  tool: string;
  args: Record<string, string>;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  /**
   * delegate 专用：sub-agent 的思考流 + 子步骤 + 汇总。
   * 存在时该 step 用 DelegateCard inline 渲染，落在 toolSteps 的调用顺序里
   * （框架串行：思考流 → 按序工具含 sub-agent 卡 → 最终 content）。
   */
  delegate?: {
    delegateId: string;
    task: string;
    content: string;
    steps: Array<{ type: 'tool'; tool?: string; args?: Record<string, string>; result?: string; ok?: boolean }>;
    summary?: string;
    status: 'running' | 'success' | 'error';
  };
}

/** 工具调用记录 */
export interface ToolCall {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  status: 'pending' | 'success' | 'error' | 'running';
  /** UI 侧通道元数据：覆盖写入时的旧内容，用于渲染真实 diff（不进 LLM 上下文） */
  diff?: { before?: string };
  /** UI 侧通道：AI 增改潮汐任务的信息卡数据（服务端按真实字段生成；启用仍在潮汐页由人操作） */
  pendingAutomation?: {
    mode: 'created' | 'updated';
    taskId: string; name: string; schedule: string; repeatCount: number; perpetual: boolean;
    selfLoop: boolean; windowN: number; enabled: boolean; agentName: string; sandboxLevel: string;
    canWriteFiles: boolean; promptPreview: string;
  };
  /** delegate 子步骤 */
  steps?: Array<{ type: 'tool' | 'thought'; tool?: string; args?: Record<string, string>; result?: string; ok?: boolean; text?: string }>;
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
  icon: 'dashboard' | 'agents' | 'chat' | 'tools' | 'skills' | 'convection' | 'cyclone' | 'tradewind' | 'tide' | 'mcp' | 'settings';
  badge?: number;
}

