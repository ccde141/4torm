import type { TideSession } from '../../api/tide';
import type { ToolImageRef } from '../../engine/tool-media';

type VisibleMessage = TideSession['messages'][number];
type ContextEntry = NonNullable<VisibleMessage['nativeContext']>[number];

/** Display follows durable raw records; native snapshots only fill holes in older sessions. */
export function visibleTideMessages(session: TideSession): TideSession['messages'] {
  const raw = session.messages.filter(message => message.role !== 'system' && message.type !== 'compact-marker');
  const rawKeys = new Set(raw.map(message => visibleKey(withToolImages(message))));
  const restored = new Set<string>();
  const ids = new Set<string>();
  const visible: VisibleMessage[] = [];
  const tools = new Map<string, string>();
  for (const message of session.messages) {
    if (ids.has(message.id)) continue;
    ids.add(message.id);
    if (message.type !== 'compact-marker') {
      if (message.role !== 'system') visible.push(withToolImages(message));
      continue;
    }
    if (!message.contextOnly && message.content.trim() !== '[历史压缩记录]') visible.push(message);
    for (const [offset, entry] of (message.nativeContext ?? []).entries()) {
      for (const projected of projectEntry(entry, `${message.id}-${offset}`, message.timestamp, tools)) {
        if (projected.role === 'system') continue;
        const key = visibleKey(projected);
        if (rawKeys.has(key) || restored.has(key)) continue;
        restored.add(key); visible.push(projected);
      }
    }
  }
  return visible;
}

function withToolImages(message: VisibleMessage): VisibleMessage {
  if (message.toolImages?.length || message.role !== 'tool-result') return message;
  try {
    const value: unknown = JSON.parse(message.content);
    if (!value || typeof value !== 'object' || !('toolImages' in value) || !Array.isArray(value.toolImages)) return message;
    const toolImages = value.toolImages.filter((image): image is ToolImageRef => !!image && typeof image === 'object'
      && 'id' in image && typeof image.id === 'string' && 'name' in image && typeof image.name === 'string'
      && 'mimeType' in image && typeof image.mimeType === 'string' && 'size' in image && typeof image.size === 'number');
    return toolImages.length ? { ...message, toolImages } : message;
  } catch { return message; }
}

function visibleKey(message: VisibleMessage): string {
  if (message.role === 'tool-call' || message.role === 'tool-result') {
    try {
      const value = JSON.parse(message.content) as Record<string, unknown>;
      return JSON.stringify([message.role, value.tool, value.args, value.result, value.ok !== false,
        message.toolImages?.map(image => image.id) ?? []]);
    } catch { /* Legacy plain tool output keeps its exact text identity. */ }
  }
  return JSON.stringify([message.role, message.content]);
}

/** Reuse the existing tool-card data contract instead of hiding native calls in an empty assistant bubble. */
function projectEntry(message: ContextEntry, id: string, timestamp: string | undefined,
  tools: Map<string, string>): VisibleMessage[] {
  const make = (role: string, content: string, suffix = ''): VisibleMessage => ({ id: id + suffix, role, content, timestamp,
    ...(message.toolImages?.length ? { toolImages: message.toolImages } : {}) });
  if (message.role === 'tool') return [make('tool-result', JSON.stringify({
    tool: tools.get(message.toolCallId ?? '') ?? message.toolCallId ?? '?',
    result: message.content, ok: message.toolOk !== false,
  }))];
  const imageResult = textImageResult(message);
  if (imageResult) return [make('tool-result', JSON.stringify(imageResult))];
  const recorded = message.role === 'user' && message.content.match(/^\[已记录的 (tool-call|tool-result)\]\n/);
  if (recorded) return [make(recorded[1], message.content.slice(recorded[0].length))];
  const visible = message.content || !message.toolCalls?.length
    ? [make(message.role, message.content)] : [];
  for (const call of message.toolCalls ?? []) {
    tools.set(call.id, call.name);
    visible.push(make('tool-call', JSON.stringify({ tool: call.name, args: toolArguments(call.arguments) }), `-${call.id}`));
  }
  return visible;
}

function textImageResult(message: ContextEntry): { tool: string; result: string; ok: boolean } | undefined {
  if (message.role !== 'user' || !message.toolImages?.length) return;
  try {
    const value: unknown = JSON.parse(message.content);
    if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'tool_result'
      || !('name' in value) || typeof value.name !== 'string'
      || !('content' in value) || typeof value.content !== 'string') return;
    return { tool: value.name, result: value.content, ok: !('ok' in value) || value.ok !== false };
  } catch { return; }
}

function toolArguments(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return { arguments: raw }; }
}
