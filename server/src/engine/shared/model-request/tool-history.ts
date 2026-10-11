import type { ContextMessage } from '../types.js';
import {
  formatTextToolCall,
  formatTextToolResult,
  parseTextToolResponse,
  parseTextToolResult,
} from '../text-tool-protocol.js';

/** Turn strict text envelopes into canonical tool messages for a native target. */
export function restoreTextToolHistory(messages: ContextMessage[]): ContextMessage[] {
  const pairedResults = new Map<number, { id: string; content: string; ok: boolean }>();
  return messages.map((message, index) => {
    if (message.role === 'assistant' && !message.toolCalls?.length) {
      const parsed = parseTextToolResponse(message.content);
      if (parsed.kind === 'tool-call') {
        const next = messages[index + 1];
        const result = next?.role === 'user' && !next.images?.length
          ? parseTextToolResult(next.content) : undefined;
        if (!result || result.name !== parsed.name) return message;
        const id = `text-history-${index}`;
        pairedResults.set(index + 1, { id, content: result.content, ok: result.ok });
        return {
          ...message,
          content: '',
          toolCalls: [{ id, name: parsed.name, arguments: JSON.stringify(parsed.arguments) }],
        };
      }
    }
    if (message.role === 'user') {
      const result = pairedResults.get(index);
      if (result) {
        return {
          role: 'tool', toolCallId: result.id, content: result.content, toolOk: result.ok,
        };
      }
    }
    return message;
  });
}

/** Keep historical tool names valid and distinct from the tools offered now. */
export function completeHistoricalToolNameMap(
  messages: ContextMessage[], currentNames: Map<string, string>,
): Map<string, string> {
  const names = new Map(currentNames);
  const used = new Set(names.values());
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (names.has(call.name)) continue;
      const base = call.name.replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tool';
      let candidate = base;
      let suffix = 1;
      while (used.has(candidate)) candidate = `${base}_${suffix++}`;
      names.set(call.name, candidate);
      used.add(candidate);
    }
  }
  return names;
}

function parseHistoricalToolArguments(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function formatHistoricalToolCall(name: string, raw: string): string {
  const value = parseHistoricalToolArguments(raw);
  return value ? formatTextToolCall(name, value)
    : JSON.stringify({ type: 'invalid_tool_call', name, raw_arguments: raw });
}

/** Make canonical native tool history readable by a text-only target. */
export function encodeNativeToolHistoryForText(
  messages: ContextMessage[], forwardToolNames: Map<string, string>,
): ContextMessage[] {
  const pending = new Map<string, string[]>();
  return messages.map(message => {
    if (message.role === 'tool') {
      const names = pending.get(message.toolCallId ?? '') ?? [];
      const name = names.shift() ?? 'unknown';
      if (!names.length) pending.delete(message.toolCallId ?? '');
      return {
        role: 'user',
        content: formatTextToolResult(name, message.content,
          message.toolOk ?? !message.content.startsWith('Error: ')),
      };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const calls = message.toolCalls.map(call => {
        const name = forwardToolNames.get(call.name) ?? call.name;
        const names = pending.get(call.id) ?? [];
        names.push(name);
        pending.set(call.id, names);
        return formatHistoricalToolCall(name, call.arguments);
      });
      return { role: 'assistant', content: [message.content, ...calls].filter(Boolean).join('\n\n') };
    }
    return message;
  });
}

/** Unfinished or malformed native groups cannot be replayed structurally. */
export function downgradeIncompleteNativeToolHistory(
  messages: ContextMessage[], forwardToolNames: Map<string, string>,
): ContextMessage[] {
  const compiled: ContextMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'tool') {
      compiled.push(...encodeNativeToolHistoryForText([message], forwardToolNames));
      continue;
    }
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      compiled.push(message);
      continue;
    }
    let end = index + 1;
    while (messages[end]?.role === 'tool') end++;
    const group = messages.slice(index, end);
    const ids = new Set(message.toolCalls.map(call => call.id));
    const results = group.slice(1);
    const resultIds = new Set(results.map(result => result.toolCallId));
    const complete = ids.size === message.toolCalls.length
      && results.length === ids.size && resultIds.size === ids.size
      && results.every(result => ids.has(result.toolCallId ?? ''))
      && message.toolCalls.every(call => parseHistoricalToolArguments(call.arguments) !== null);
    compiled.push(...(complete ? group : encodeNativeToolHistoryForText(group, forwardToolNames)));
    index = end - 1;
  }
  return compiled;
}
