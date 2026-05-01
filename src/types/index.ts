/** Agent 运行状态（字符串引用 StatusDef.id） */
export type AgentStatus = string;

/** Agent 信息 */
export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
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
}

/** 工具调用记录 */
export interface ToolCall {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  status: 'pending' | 'success' | 'error';
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
  maxToolCalls?: number;
  maxContextTokens?: number;
  workspace?: string;
}

/** 导航项 */
export interface NavItem {
  id: string;
  label: string;
  icon: 'dashboard' | 'agents' | 'chat' | 'tools' | 'skills' | 'sandbox' | 'settings';
  badge?: number;
}

