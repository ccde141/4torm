import type { ProviderAdapter } from './types.js';
import { formatTextToolCall, formatTextToolResult } from '../text-tool-protocol.js';

type RequestMessage = Record<string, unknown>;

function containsArray(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(containsArray);
}

function parseArguments(call: RequestMessage): Record<string, unknown> | undefined {
  const fn = call.function;
  if (!fn || typeof fn !== 'object') return undefined;
  const raw = (fn as RequestMessage).arguments;
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function rewriteArrayArgumentHistory(messages: unknown[]): unknown[] {
  const output: unknown[] = [];
  const encodedCalls = new Map<string, string>();

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') {
      output.push(raw);
      continue;
    }
    const message = raw as RequestMessage;
    const calls = message.role === 'assistant' && Array.isArray(message.tool_calls)
      ? message.tool_calls.filter((call): call is RequestMessage => !!call && typeof call === 'object')
      : [];
    const parsedCalls = calls.map(call => ({ call, args: parseArguments(call) }));
    const needsText = parsedCalls.some(item => item.args && containsArray(item.args));
    if (needsText && parsedCalls.every(item => item.args)) {
      const content = [
        typeof message.content === 'string' ? message.content : '',
        ...parsedCalls.map(({ call, args }) => formatTextToolCall(
          String((call.function as RequestMessage).name ?? 'unknown'), args!,
        )),
      ].filter(Boolean).join('\n\n');
      for (const { call } of parsedCalls) {
        if (typeof call.id === 'string') {
          encodedCalls.set(call.id, String((call.function as RequestMessage).name ?? 'unknown'));
        }
      }
      const { tool_calls: _toolCalls, ...withoutCalls } = message;
      output.push({ ...withoutCalls, content });
      continue;
    }
    if (message.role === 'tool' && typeof message.tool_call_id === 'string') {
      const name = encodedCalls.get(message.tool_call_id);
      if (name) {
        const content = typeof message.content === 'string' ? message.content : String(message.content ?? '');
        output.push({
          role: 'user',
          content: formatTextToolResult(name, content, !content.startsWith('Error: ')),
        });
        encodedCalls.delete(message.tool_call_id);
        continue;
      }
    }
    output.push(message);
  }
  return output;
}

function omitEmptyAssistantMessages(body: Record<string, unknown>): void {
  if (!Array.isArray(body.messages)) return;
  body.messages = rewriteArrayArgumentHistory(body.messages).filter(message => {
    if (!message || typeof message !== 'object') return true;
    const item = message as Record<string, unknown>;
    if (item.role !== 'assistant') return true;
    if (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) return true;
    return typeof item.content === 'string' && item.content.trim().length > 0;
  });
}

export const lmStudioAdapter: ProviderAdapter = {
  id: 'lmstudio',
  matches: () => false,
  capabilities: {
    temperature: 'passthrough',
    maxTokensField: 'max_tokens',
    reasoningHistory: 'omit',
  },
  normalizeRequest: omitEmptyAssistantMessages,
};
