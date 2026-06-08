/**
 * 普通会话引擎类型定义
 *
 * 与前端 src/types/index.ts 中的 ChatSession / ChatMessage 保持兼容。
 * 后端持久化格式不变（data/agents/{id}/sessions/{sid}.json）。
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  agentId?: string;
  toolCall?: ToolCallInfo;
  /** 运行时类型标记（如 'compact-marker'） */
  type?: string;
}

export interface ToolCallInfo {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  status: 'pending' | 'running' | 'success' | 'error';
  steps?: ToolStep[];
}

export interface ToolStep {
  type: 'tool' | 'thought';
  tool?: string;
  args?: Record<string, string>;
  result?: string;
  ok?: boolean;
  text?: string;
}

export interface ChatSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  titleManual?: boolean;
  messages: ChatMessage[];
  model: string;
  systemPrompt: string;
  masterPrompt?: string;
  rolePrompt?: string;
  lastReadAt?: string;
  /** 累计 token 用量（真实 API 返回值） */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  createdAt: string;
  updatedAt: string;
}
