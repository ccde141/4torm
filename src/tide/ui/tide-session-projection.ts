import type { TideSession } from '../../api/tide';

type VisibleMessage = TideSession['messages'][number];
type ContextEntry = NonNullable<VisibleMessage['nativeContext']>[number];

/** The newest exact marker describes model-active history; raw originals remain archived. */
export function visibleTideMessages(session: TideSession): TideSession['messages'] {
  const index = session.messages.findLastIndex(message => message.type === 'compact-marker');
  if (index < 0) return session.messages.filter(message => message.role !== 'system');
  const marker = session.messages[index];
  const tools = new Map<string, string>();
  const compacted = (marker.nativeContext ?? [{ role: 'system', content: marker.content }])
    .flatMap((message, offset) => {
      const entries = projectEntry(message, `${marker.id}-${offset}`, marker.timestamp, tools);
      return offset === 0 && message.role === 'system'
        ? entries.map(entry => ({ ...entry, type: 'compact-marker' as const })) : entries;
    });
  return [...compacted, ...session.messages.slice(index + 1).filter(message => message.role !== 'system')];
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
