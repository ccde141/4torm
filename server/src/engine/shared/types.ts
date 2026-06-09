/**
 * 共享基础类型 —— 信风 & 对流共用
 *
 * 这些类型是纯数据结构，无业务逻辑，无 IO。
 * 两个模块各自 import 此处，互不依赖。
 */

/** 消息角色 */
export type ContextRole = 'user' | 'assistant' | 'system';

/** 单条上下文消息 */
export interface ContextMessage {
  role: ContextRole;
  content: string;
}

/** LLM 调用选项（最小够用） */
export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
