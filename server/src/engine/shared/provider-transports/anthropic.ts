import type { ContextMessage, ProviderReasoningEnvelope } from '../types.js';
import type { ToolDef } from '../tool-defs-loader.js';

interface AnthropicRequestInput {
  baseUrl: string;
  apiKey?: string;
  customHeaders?: Record<string, string>;
  model: string;
  messages: ContextMessage[];
  tools?: ToolDef[];
  stream: boolean;
  maxTokens: number;
  temperature?: number;
}

interface AnthropicRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
  nameMap: Map<string, string>;
}

type ContentBlock = Record<string, unknown>;

export interface AnthropicResult {
  content: string;
  reasoningContent?: string;
  reasoningEnvelope?: ProviderReasoningEnvelope;
  finishReason: 'stop' | 'length' | 'tool_calls' | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export function buildAnthropicRequest(input: AnthropicRequestInput): AnthropicRequest {
  const { tools, nameMap, forwardMap } = mapTools(input.tools ?? []);
  const { system, messages } = mapMessages(input.messages, forwardMap);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(input.customHeaders ?? {}),
  };
  if (input.apiKey && !hasHeader(headers, 'x-api-key')) headers['x-api-key'] = input.apiKey;

  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    max_tokens: input.maxTokens,
    stream: input.stream,
  };
  if (system) body.system = system;
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (tools.length) body.tools = tools;

  return { url: messagesUrl(input.baseUrl), headers, body, nameMap };
}

function messagesUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  return clean.endsWith('/messages') ? clean : `${clean}/messages`;
}

function hasHeader(headers: Record<string, string>, target: string): boolean {
  return Object.keys(headers).some(name => name.toLowerCase() === target);
}

function mapTools(defs: ToolDef[]) {
  const used = new Set<string>();
  const nameMap = new Map<string, string>();
  const forwardMap = new Map<string, string>();
  const tools = defs.map(def => {
    const name = safeToolName(def.name, used);
    if (name !== def.name) {
      nameMap.set(name, def.name);
      forwardMap.set(def.name, name);
    }
    return {
      name,
      description: def.description ?? '',
      input_schema: {
        type: 'object',
        properties: def.parameters?.properties ?? {},
        required: Array.isArray(def.parameters?.required) ? def.parameters.required : [],
      },
    };
  });
  return { tools, nameMap, forwardMap };
}

function safeToolName(name: string, used: Set<string>): string {
  const base = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tool';
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function mapMessages(messages: ContextMessage[], forwardMap: Map<string, string>) {
  const system = messages.filter(message => message.role === 'system')
    .map(message => message.content).filter(Boolean).join('\n\n');
  const mapped: Array<{ role: 'user' | 'assistant'; content: ContentBlock[] }> = [];

  for (const message of messages) {
    if (message.role === 'system') continue;
    const next = mapMessage(message, forwardMap);
    const previous = mapped.at(-1);
    if (previous?.role === next.role) previous.content.push(...next.content);
    else mapped.push(next);
  }
  return { system, messages: mapped };
}

function mapMessage(
  message: ContextMessage,
  forwardMap: Map<string, string>,
): { role: 'user' | 'assistant'; content: ContentBlock[] } {
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new Error('Anthropic 工具结果缺少 toolCallId');
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }],
    };
  }

  const content: ContentBlock[] = message.content
    ? [{ type: 'text', text: message.content }]
    : [];
  if (message.role === 'user') {
    content.push(...(message.images ?? []).map(image => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mimeType,
        data: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1),
      },
    })));
  }
  if (message.role === 'assistant' && message.reasoningEnvelope?.field === 'anthropic_thinking') {
    content.unshift(...message.reasoningEnvelope.value.filter(isContentBlock));
  }
  for (const toolCall of message.toolCalls ?? []) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: forwardMap.get(toolCall.name) ?? toolCall.name,
      input: parseToolInput(toolCall.name, toolCall.arguments),
    });
  }
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content };
}

function parseToolInput(name: string, value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    throw new Error(`Anthropic 工具历史参数无法解析：${name}`, { cause: error });
  }
  throw new Error(`Anthropic 工具历史参数必须是 JSON 对象：${name}`);
}

export function parseAnthropicResponse(
  source: Record<string, any>,
  nameMap: Map<string, string>,
): AnthropicResult {
  const blocks = Array.isArray(source.content) ? source.content : [];
  const text = blocks.filter(block => block?.type === 'text')
    .map(block => block.text ?? '').join('');
  const reasoning = blocks.filter(block => block?.type === 'thinking')
    .map(block => block.thinking ?? '').join('');
  const thinkingBlocks = blocks.filter(block =>
    block?.type === 'thinking' || block?.type === 'redacted_thinking');
  const toolCalls = blocks.filter(block => block?.type === 'tool_use' && block.name)
    .map(block => ({
      id: String(block.id ?? ''),
      name: nameMap.get(block.name) ?? block.name,
      arguments: JSON.stringify(block.input ?? {}),
    }));
  const reasoningEnvelope = thinkingEnvelope(thinkingBlocks);
  return {
    content: text,
    reasoningContent: reasoning || undefined,
    ...(reasoningEnvelope ? { reasoningEnvelope } : {}),
    finishReason: normalizeStopReason(source.stop_reason),
    usage: normalizeUsage(source.usage?.input_tokens, source.usage?.output_tokens),
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
}

export function createAnthropicStreamAccumulator(
  nameMap: Map<string, string>,
  onChunk: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
) {
  const state: StreamState = {
    content: '', reasoning: '', finishReason: null, inputTokens: 0, outputTokens: 0,
    tools: new Map(), thinkingBlocks: new Map(),
  };

  return {
    push(event: Record<string, any>) {
      applyStreamEvent(state, event, onChunk, onReasoning);
    },
    finish(): AnthropicResult {
      const toolCalls = [...state.tools.entries()].sort((a, b) => a[0] - b[0]).map(([, tool]) => ({
        id: tool.id,
        name: nameMap.get(tool.name) ?? tool.name,
        arguments: tool.json || '{}',
      }));
      const reasoningEnvelope = thinkingEnvelope(
        [...state.thinkingBlocks.entries()].sort((a, b) => a[0] - b[0]).map(([, block]) => block),
      );
      return {
        content: state.content,
        reasoningContent: state.reasoning || undefined,
        ...(reasoningEnvelope ? { reasoningEnvelope } : {}),
        finishReason: state.finishReason,
        usage: normalizeUsage(state.inputTokens, state.outputTokens),
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
    },
  };
}

interface StreamState {
  content: string;
  reasoning: string;
  finishReason: AnthropicResult['finishReason'];
  inputTokens: number;
  outputTokens: number;
  tools: Map<number, { id: string; name: string; json: string }>;
  thinkingBlocks: Map<number, ContentBlock>;
}

function applyStreamEvent(
  state: StreamState,
  event: Record<string, any>,
  onChunk: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
) {
  if (event.type === 'message_start') state.inputTokens = event.message?.usage?.input_tokens ?? state.inputTokens;
  if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    state.tools.set(event.index ?? 0, {
      id: event.content_block.id ?? '', name: event.content_block.name ?? '',
      json: event.content_block.input && Object.keys(event.content_block.input).length
        ? JSON.stringify(event.content_block.input) : '',
    });
  }
  if (event.type === 'content_block_start'
    && ['thinking', 'redacted_thinking'].includes(event.content_block?.type)) {
    state.thinkingBlocks.set(event.index ?? 0, { ...event.content_block });
  }
  const delta = event.type === 'content_block_delta' ? event.delta ?? {} : {};
  if (delta.type === 'text_delta' && delta.text) {
    state.content += delta.text;
    onChunk(delta.text);
  }
  if (delta.type === 'thinking_delta' && delta.thinking) {
    state.reasoning += delta.thinking;
    appendThinkingField(state, event.index ?? 0, 'thinking', delta.thinking);
    onReasoning?.(delta.thinking);
  }
  if (delta.type === 'signature_delta' && delta.signature) {
    appendThinkingField(state, event.index ?? 0, 'signature', delta.signature);
  }
  if (delta.type === 'input_json_delta') {
    const tool = state.tools.get(event.index ?? 0);
    if (tool) tool.json += delta.partial_json ?? '';
  }
  if (event.type === 'message_delta') {
    state.finishReason = normalizeStopReason(event.delta?.stop_reason);
    state.outputTokens = event.usage?.output_tokens ?? state.outputTokens;
  }
}

function appendThinkingField(
  state: StreamState,
  index: number,
  field: 'thinking' | 'signature',
  chunk: string,
) {
  const block = state.thinkingBlocks.get(index) ?? { type: 'thinking' };
  block[field] = `${typeof block[field] === 'string' ? block[field] : ''}${chunk}`;
  state.thinkingBlocks.set(index, block);
}

function isContentBlock(value: unknown): value is ContentBlock {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function thinkingEnvelope(blocks: unknown[]): ProviderReasoningEnvelope | undefined {
  return blocks.length ? { field: 'anthropic_thinking', value: blocks } : undefined;
}

function normalizeStopReason(value: unknown): AnthropicResult['finishReason'] {
  if (value === 'tool_use') return 'tool_calls';
  if (value === 'max_tokens') return 'length';
  if (value === 'end_turn' || value === 'stop_sequence' || value === 'pause_turn') return 'stop';
  return null;
}

function normalizeUsage(input: unknown, output: unknown): AnthropicResult['usage'] {
  const promptTokens = typeof input === 'number' ? input : 0;
  const completionTokens = typeof output === 'number' ? output : 0;
  if (!promptTokens && !completionTokens) return undefined;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}
