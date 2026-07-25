/**
 * 共享基础类型 —— 信风 & 对流共用
 *
 * 这些类型是纯数据结构，无业务逻辑，无 IO。
 * 两个模块各自 import 此处，互不依赖。
 */

/** 消息角色（tool = 原生工具调用结果） */
export type ContextRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 原生工具调用（OpenAI tool_calls 规范化形态）。
 * 仅原生工具模式使用；JSON 文本工具模式由框架解析调用信封。
 */
export interface NativeToolCall {
  /** provider 返回的 tool_call id（回填时必须原样带回，不可自造） */
  id: string;
  /** 工具名 */
  name: string;
  /** 原始 JSON 字符串（openai 风格；解析成对象只在喂 execTool 时做） */
  arguments: string;
}

export interface ProviderReasoningEnvelope {
  field: 'reasoning_details' | 'anthropic_thinking';
  value: unknown[];
}

/** 已由本地附件存储解析、可直接发送给供应商的图片。 */
export interface ProviderImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

/** 单条上下文消息 */
export interface ContextMessage {
  role: ContextRole;
  content: string;
  /** 仅允许出现在 user 消息中。 */
  images?: ProviderImage[];
  /** Provider 原生推理内容；与正文分开，但需随 assistant 历史原样回传。 */
  reasoningContent?: string;
  /** 供应商要求逐字回传的结构化推理块，不用于界面展示。 */
  reasoningEnvelope?: ProviderReasoningEnvelope;
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
