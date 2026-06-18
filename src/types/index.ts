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
   * 流式期间的内嵌工具步骤（运行时字段，不持久化到磁盘）。
   * 流结束后，重新加载时由 parseStructuredOutput(rawContent) 重生成。
   */
  toolSteps?: ToolStep[];
  /** 流式阶段标识（运行时字段，不持久化） */
  streamingPhase?: 'llm-waiting' | 'tool-exec';
  /** 当前阶段已等待秒数（运行时字段） */
  phaseElapsed?: number;
}

/** 工具调用步骤（StructuredMessage 与流式期间共用） */
export interface ToolStep {
  tool: string;
  args: Record<string, string>;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

/** 工具调用记录 */
export interface ToolCall {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  status: 'pending' | 'success' | 'error' | 'running';
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
   * 文件工具沙箱级别。
   * - 'strict'       严格 — 只能在 workspaceDir 内读写（use_skill 等系统工具不受限）
   * - 'relaxed'（默认）弱限制 — 可在 workspaceDir 或软件项目根目录内读写
   * - 'unrestricted' 无限制 — 可在文件系统任意位置读写
   */
  sandboxLevel?: 'strict' | 'relaxed' | 'unrestricted';
}

/** 导航项 */
export interface NavItem {
  id: string;
  label: string;
  icon: 'dashboard' | 'agents' | 'chat' | 'tools' | 'skills' | 'convection' | 'tradewind' | 'tide' | 'mcp' | 'settings';
  badge?: number;
}

