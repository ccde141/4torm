import type { ContextMessage, ToolImageRef } from '../../shared/types.js';
import { parseTextToolResponse, parseTextToolResult } from '../../shared/text-tool-protocol.js';

export interface NodeHistoryToolStep {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'done' | 'error';
  toolImages?: ToolImageRef[];
}
export interface NodeHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  messageId?: string;
  reasoningContent?: string;
  toolSteps?: NodeHistoryToolStep[];
}
type StoredMessage = ContextMessage & { messageId?: string };

/** A node's human view keeps actual tool evidence, without exposing provider control messages. */
export function projectNodeHistory(messages: readonly StoredMessage[]): NodeHistoryMessage[] {
  const output: NodeHistoryMessage[] = [];
  const consumed = new Set<number>();
  for (const [index, message] of messages.entries()) {
    if (consumed.has(index) || message.role === 'tool') continue;
    const base = { ...(message.messageId ? { messageId: message.messageId } : {}),
      ...(message.reasoningContent ? { reasoningContent: message.reasoningContent } : {}) };
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const batch = new Map<string, StoredMessage>();
      for (let cursor = index + 1; cursor < messages.length && messages[cursor]!.role === 'tool'; cursor++) {
        const result = messages[cursor]!;
        if (result.toolCallId && !batch.has(result.toolCallId)) batch.set(result.toolCallId, result);
      }
      const steps = message.toolCalls.map(call => {
        const result = batch.get(call.id);
        batch.delete(call.id);
        return step(call.name, argumentsObject(call.arguments), result?.content,
          result ? result.toolOk !== false : false, result?.toolImages);
      });
      output.push({ ...base, role: 'assistant', content: message.content, toolSteps: steps });
      continue;
    }
    const parsed = message.role === 'assistant' ? parseTextToolResponse(message.content) : undefined;
    const next = messages[index + 1];
    const result = next?.role === 'user' ? parseTextToolResult(next.content) : undefined;
    if (parsed?.kind === 'tool-call' && result?.name === parsed.name) {
      consumed.add(index + 1);
      output.push({ ...base, role: 'assistant', content: '', toolSteps: [
        step(parsed.name, parsed.arguments, result.content, result.ok, next?.toolImages),
      ] });
      continue;
    }
    output.push({ ...base, role: message.role,
      content: parsed?.kind === 'final' ? parsed.content : message.content });
  }
  return output;
}

function step(tool: string, args: Record<string, unknown>, result: string | undefined,
  ok: boolean, toolImages?: ToolImageRef[]): NodeHistoryToolStep {
  return { tool, args, result: result ?? '未收到工具执行结果', status: ok ? 'done' : 'error',
    ...(toolImages?.length ? { toolImages } : {}) };
}
function argumentsObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Invalid historic arguments remain available as their original text. */ }
  return { raw: text };
}
