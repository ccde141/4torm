/**
 * Agent 系统运行状态（互斥锁）。
 * 仅限系统内部修改，用户不可手动改写。
 * 合法值见 SystemStatus 枚举。
 */
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
  /** LLM 流式输出中（短暂互斥锁） */
  busy?: boolean;
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

/** 单条消息 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  agentId?: string;
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
   * 原生模式下 rawContent 不含 <action>，故此字段是工具调用的唯一源数据，
   * 需持久化：既用于重载渲染，也用于跨轮次历史回灌（见 ChatPage 历史重建）。
   * 文本模式下亦可由 parseStructuredOutput(rawContent) 重生成。
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
  /**
   * 该回复是否由原生工具调用模式（native tool_calls）产生。持久化：重载后仍需据此
   * 决定前端是否扫描正文里的 <action> 文本标签——native 模式正文不该有真实调用，
   * 扫描只会把模型幻觉/引用的 <action> 误判成调用（见 parseStructuredOutput opts.native）。
   * 老会话为 undefined → 按文本模式处理（安全兜底）。
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
  skills?: string[];
  workspace?: string;
  /**
   * 旧权限档字段，仅为历史数据兼容保留；当前执行策略不再按此分支。
   */
  sandboxLevel?: 'strict' | 'relaxed' | 'unrestricted';
}

/** 导航项 */
export interface NavItem {
  id: string;
  label: string;
  icon: 'dashboard' | 'agents' | 'chat' | 'tools' | 'skills' | 'convection' | 'cyclone' | 'tradewind' | 'tide' | 'mcp' | 'settings';
  badge?: number;
}

