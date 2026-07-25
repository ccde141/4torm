import type {
  ContextMessage,
  NativeToolCall,
  ProviderReasoningEnvelope,
} from './types.js';
import {
  resolveProviderModelCapabilities,
  type ProviderModelIdentity,
} from './provider-normalization.js';

export function mapProviderMessages(
  messages: ContextMessage[],
  forwardMap: Map<string, string>,
  identity: ProviderModelIdentity,
): Array<Record<string, unknown>> {
  const reasoningHistory = resolveProviderModelCapabilities(identity).reasoningHistory;
  return messages.map(message => mapProviderMessage(message, forwardMap, reasoningHistory));
}

export function createAssistantContextMessage(
  content: string,
  toolCalls?: NativeToolCall[],
  reasoningContent?: string,
  reasoningEnvelope?: ProviderReasoningEnvelope,
): ContextMessage {
  return {
    role: 'assistant', content,
    ...(toolCalls?.length ? { toolCalls } : {}),
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(reasoningEnvelope ? { reasoningEnvelope } : {}),
  };
}

export function extractReasoningContent(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const source = message as Record<string, unknown>;
  const value = source.reasoning_content ?? source.reasoning ?? source.thinking;
  return typeof value === 'string' ? value : '';
}

export function extractReasoningEnvelope(message: unknown): ProviderReasoningEnvelope | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const value = (message as Record<string, unknown>).reasoning_details;
  return Array.isArray(value) ? { field: 'reasoning_details', value } : undefined;
}

function mapProviderMessage(
  message: ContextMessage,
  forwardMap: Map<string, string>,
  reasoningHistory: 'omit' | 'reasoning_content' | 'reasoning_details',
): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  const content = message.role === 'user' && message.images?.length
    ? [
        ...(message.content ? [{ type: 'text', text: message.content }] : []),
        ...message.images.map(image => ({
          type: 'image_url', image_url: { url: image.dataUrl },
        })),
      ]
    : message.content;
  const mapped: Record<string, unknown> = { role: message.role, content };
  if (message.role !== 'assistant') return mapped;
  if (reasoningHistory === 'reasoning_content' && message.reasoningContent) {
    mapped.reasoning_content = message.reasoningContent;
  }
  if (reasoningHistory === 'reasoning_details'
    && message.reasoningEnvelope?.field === 'reasoning_details') {
    mapped.reasoning_details = message.reasoningEnvelope.value;
  }
  if (!message.toolCalls?.length) return mapped;
  mapped.content = message.content || null;
  mapped.tool_calls = message.toolCalls.map(toolCall => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: forwardMap.get(toolCall.name) ?? toolCall.name,
      arguments: toolCall.arguments,
    },
  }));
  return mapped;
}
