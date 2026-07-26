import type { ContextMessage } from '../types.js';
import {
  mapProviderMessages,
} from '../provider-messages.js';
import type { ProviderModelIdentity } from '../provider-normalization.js';
import {
  formatTextToolCall,
  formatTextToolResult,
  parseTextToolResponse,
  parseTextToolResult,
} from '../text-tool-protocol.js';

export interface ModelRequestMessageOptions {
  identity: ProviderModelIdentity;
  forwardToolNames: Map<string, string>;
  toolTransport?: 'native' | 'text';
}

function restoreTextToolHistory(messages: ContextMessage[]): ContextMessage[] {
  const pending = new Map<string, string[]>();
  return messages.map((message, index) => {
    if (message.role === 'assistant') {
      const parsed = parseTextToolResponse(message.content);
      if (parsed.kind === 'tool-call') {
        const id = `text-history-${index}`;
        const ids = pending.get(parsed.name) ?? [];
        pending.set(parsed.name, [...ids, id]);
        return {
          ...message,
          content: '',
          toolCalls: [{ id, name: parsed.name, arguments: JSON.stringify(parsed.arguments) }],
        };
      }
    }
    if (message.role === 'user') {
      const result = parseTextToolResult(message.content);
      const ids = result ? pending.get(result.name) : undefined;
      if (result && ids?.length) {
        const [toolCallId, ...remaining] = ids;
        if (remaining.length) pending.set(result.name, remaining);
        else pending.delete(result.name);
        return { role: 'tool', toolCallId, content: result.content };
      }
    }
    return message;
  });
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function compileTextMessages(
  messages: ContextMessage[],
  options: ModelRequestMessageOptions,
): Array<Record<string, unknown>> {
  const names = new Map(messages.flatMap(message =>
    (message.toolCalls ?? []).map(call => [call.id, call.name] as const)));
  return messages.flatMap(message => {
    if (message.role === 'tool') {
      const name = names.get(message.toolCallId ?? '') ?? 'unknown';
      return [{
        role: 'user',
        content: formatTextToolResult(name, message.content, !message.content.startsWith('Error: ')),
      }];
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const calls = message.toolCalls.map(call => formatTextToolCall(
        options.forwardToolNames.get(call.name) ?? call.name,
        parseArguments(call.arguments),
      ));
      return [{ role: 'assistant', content: [message.content, ...calls].filter(Boolean).join('\n\n') }];
    }
    return mapProviderMessages([message], options.forwardToolNames, options.identity);
  });
}

/** Compile canonical session messages for the currently selected model. */
export function compileModelMessages(
  messages: ContextMessage[],
  options: ModelRequestMessageOptions,
): Array<Record<string, unknown>> {
  if (options.toolTransport === 'text') {
    return compileTextMessages(messages, options);
  }
  return mapProviderMessages(
    restoreTextToolHistory(messages),
    options.forwardToolNames,
    options.identity,
  );
}
