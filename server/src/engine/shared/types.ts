/**
 * 共享基础类型 —— 信风 & 对流共用
 *
 * 这些类型是纯数据结构，无业务逻辑，无 IO。
 * 两个模块各自 import 此处，互不依赖。
 */

/** 消息角色（tool = 原生工具调用结果，文本协议模式不使用） */
export type ContextRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 原生工具调用（OpenAI tool_calls 规范化形态）。
 * 仅原生模式使用；文本协议模式下 ContextMessage 不携带此结构。
 */
export interface NativeToolCall {
  /** provider 返回的 tool_call id（回填时必须原样带回，不可自造） */
  id: string;
  /** 工具名 */
  name: string;
  /** 原始 JSON 字符串（openai 风格；解析成对象只在喂 execTool 时做） */
  arguments: string;
}

/** 单条上下文消息 */
export interface ContextMessage {
  role: ContextRole;
  content: string;
  /**
   * 原生模式专用字段（文本模式不填，保持向后兼容）。
   * 任何按 {role, content} 消费的旧代码不受影响。
   */
  /** assistant 消息携带的工具调用（role=assistant 时） */
  toolCalls?: NativeToolCall[];
  /** tool 结果消息携带的配对 id（role=tool 时） */
  toolCallId?: string;
}

/** LLM 调用选项（最小够用） */
export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
