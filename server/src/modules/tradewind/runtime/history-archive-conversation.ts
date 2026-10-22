import { parseTextToolResponse, parseTextToolResult } from '../../../engine/shared/text-tool-protocol.js';
import { record } from './history-storage.js';
import { readToolImageRefs } from '../../../engine/shared/tool-media-store.js';
import type { ToolImageRef } from '../../../engine/shared/types.js';

interface VisibleMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  source?: string;
  toolName?: string;
  scope?: 'public' | 'chair';
  timestamp?: string | number;
  toolImages?: ToolImageRef[];
}

/** Persisted provider context stays on disk; record views receive only conversation fields. */
export function projectArchivedConversation(value: unknown, meeting: boolean): VisibleMessage[] {
  if (!meeting) return projectMessages(Array.isArray(value) ? value : []);
  if (Array.isArray(value)) return projectMessages(value, 'public');
  if (!record(value)) return [];
  return [...projectMessages(Array.isArray(value.publicMessages) ? value.publicMessages : [], 'public'),
    ...projectMessages(Array.isArray(value.chairMessages) ? value.chairMessages : [], 'chair')];
}

function projectMessages(messages: unknown[], scope?: VisibleMessage['scope']): VisibleMessage[] {
  const visible: VisibleMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (!record(message) || typeof message.content !== 'string' || message.role === 'system') continue;
    const speaker = typeof message.speaker === 'string' ? message.speaker : undefined;
    if (speaker?.startsWith('[系统信息') || isInjectedInput(message)) continue;
    const role = message.role === 'user' || message.role === 'assistant' || message.role === 'tool' ? message.role
      : scope === 'public' && speaker ? 'assistant' : undefined;
    if (!role) continue;
    const base = { ...(scope ? { scope } : {}), ...(speaker ? { source: speaker } : {}),
      ...(message.toolImages !== undefined ? { toolImages: readToolImageRefs(message.toolImages) } : {}),
      ...(typeof message.timestamp === 'string' || typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}) };
    const parsedResult = role === 'user' ? parseTextToolResult(message.content) : undefined;
    if (parsedResult) {
      visible.push({ ...base, role: 'tool', toolName: parsedResult.name, content: parsedResult.content });
      continue;
    }
    if (role === 'tool') {
      visible.push({ ...base, role, content: message.content,
        ...(typeof message.toolCallId === 'string' && toolNames.has(message.toolCallId)
          ? { toolName: toolNames.get(message.toolCallId) } : {}) });
      continue;
    }
    const parsed = role === 'assistant' ? parseTextToolResponse(message.content) : undefined;
    if (parsed?.kind === 'tool-call') visible.push({ ...base, role: 'tool', toolName: parsed.name,
      content: JSON.stringify(parsed.arguments, null, 2) });
    else if (parsed?.kind !== 'invalid' && message.content) visible.push({ ...base, role,
      content: parsed?.kind === 'final' ? parsed.content : message.content });
    if (role === 'assistant' && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) {
        if (!record(call)) continue;
        const name = typeof call.name === 'string' ? call.name : typeof call.tool === 'string' ? call.tool : undefined;
        if (!name) continue;
        if (typeof call.id === 'string') toolNames.set(call.id, name);
        const args = typeof call.arguments === 'string' ? call.arguments
          : record(call.args) ? JSON.stringify(call.args, null, 2) : '';
        const content = [args, typeof call.result === 'string' ? call.result : ''].filter(Boolean).join('\n\n');
        visible.push({ ...base, role: 'tool', toolName: name, content,
          ...(call.toolImages !== undefined ? { toolImages: readToolImageRefs(call.toolImages) } : {}) });
      }
    }
  }
  return visible;
}

function isInjectedInput(message: Record<string, unknown>): boolean {
  return message.role === 'user' && typeof message.content === 'string'
    && message.content.trimStart().startsWith('[系统信息');
}
