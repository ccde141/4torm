import type { MeetingCompaction, ToolStep } from './meeting-client';

interface DisplayTurn {
  content: string; rawContent?: string; reasoning?: string; reasoningContent?: string;
  toolCalls?: ToolStep[]; streaming?: boolean; compactions?: MeetingCompaction[];
}

/** Both REST and stream snapshots resume against the complete persisted turn coordinates. */
export function meetingPublicStreamSnapshot(messages: readonly (DisplayTurn & { speaker: string })[]) {
  const active = messages.findLast(message => message.streaming);
  return { currentLabel: active?.speaker ?? '', streamContent: active?.rawContent ?? active?.content ?? '',
    reasoningContent: active?.reasoning ?? '', pendingTools: active?.toolCalls ?? [] };
}

/** Slice only presentation coordinates; the source record and its task remain intact. */
export function splitMeetingCompactions<T extends DisplayTurn>(message: T): Array<{
  message: T; boundary?: MeetingCompaction; continued: boolean;
}> {
  if (!message.compactions?.length) return [{ message, continued: false }];
  const seen = new Set<string>();
  const boundaries = message.compactions.filter(boundary => {
    if (seen.has(boundary.id)) return false;
    seen.add(boundary.id); return true;
  });
  const text = message.rawContent ?? message.content;
  const reasoning = message.reasoning ?? message.reasoningContent ?? '';
  const tools = message.toolCalls ?? [];
  let textStart = 0; let reasoningStart = 0; let toolStart = 0;
  return [...boundaries, undefined].map((end, index) => {
    const textEnd = end ? Math.min(text.length, Math.max(textStart, end.textOffset)) : text.length;
    const reasoningEnd = end ? Math.min(reasoning.length, Math.max(reasoningStart, end.reasoningOffset)) : reasoning.length;
    const toolEnd = end ? Math.min(tools.length, Math.max(toolStart, end.toolOffset)) : tools.length;
    const segment = { ...message, compactions: undefined, content: text.slice(textStart, textEnd),
      ...(message.rawContent !== undefined ? { rawContent: text.slice(textStart, textEnd) } : {}),
      ...(message.reasoning !== undefined ? { reasoning: reasoning.slice(reasoningStart, reasoningEnd) } : {}),
      ...(message.reasoningContent !== undefined ? { reasoningContent: reasoning.slice(reasoningStart, reasoningEnd) } : {}),
      ...(message.toolCalls ? { toolCalls: tools.slice(toolStart, toolEnd) } : {}), streaming: !end && message.streaming };
    textStart = textEnd; reasoningStart = reasoningEnd; toolStart = toolEnd;
    return { message: segment, boundary: index > 0 ? boundaries[index - 1] : undefined, continued: !!end };
  });
}

export function appendMeetingCompaction<T extends { compactions?: MeetingCompaction[] }>(message: T, boundary: MeetingCompaction): T {
  return message.compactions?.some(item => item.id === boundary.id) ? message
    : { ...message, compactions: [...(message.compactions ?? []), boundary] };
}
