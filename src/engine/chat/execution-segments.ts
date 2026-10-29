import type { ChatActivity, ChatMessage } from '../../types';
import { projectActivityTurn } from './activity-sequence';

export type ExecutionBoundary = Extract<ChatActivity, { kind: 'compact' }>;

export interface ExecutionSegment {
  id: string;
  work: ChatActivity[];
  toolOffset: number;
  continued: boolean;
  boundary?: ExecutionBoundary;
  reasoningStart: number;
  reasoningEnd: number;
}

/** Display segments share one persisted assistant, tool array and execution identity. */
export function executionSegments(message: ChatMessage, markers: ChatMessage[] = []): {
  segments: ExecutionSegment[]; answer: string;
} {
  const { work, answer } = projectActivityTurn(withExecutionBoundaries(message, markers));
  const segments: ExecutionSegment[] = [
    { id: message.id, work: [], toolOffset: 0, continued: false, reasoningStart: 0, reasoningEnd: 0 },
  ];
  for (const item of work) {
    if (item.kind !== 'compact') { segments.at(-1)!.work.push(item); continue; }
    segments.at(-1)!.continued = true;
    segments.push({ id: item.markerId, work: [], toolOffset: item.toolOffset,
      continued: false, boundary: item, reasoningStart: 0, reasoningEnd: 0 });
  }
  assignReasoningRanges(segments, message.reasoningContent?.length ?? 0, markers);
  return { segments, answer };
}

function assignReasoningRanges(segments: ExecutionSegment[], length: number, markers: ChatMessage[]): void {
  const offsets = segments.slice(1).map(segment => segment.boundary?.reasoningOffset
    ?? markers.find(marker => marker.id === segment.id)?.execution?.reasoningOffset);
  const exact = offsets.every((offset, index) => Number.isSafeInteger(offset) && Number(offset) >= 0
    && Number(offset) <= length && (index === 0 || Number(offset) >= Number(offsets[index - 1])));
  const starts = exact ? [0, ...offsets.map(Number)] : [0, ...offsets.map(() => length)];
  segments.forEach((segment, index) => {
    segment.reasoningStart = starts[index];
    segment.reasoningEnd = starts[index + 1] ?? length;
  });
}

/** Recover display boundaries from committed markers without rewriting the stored assistant. */
export function withExecutionBoundaries(message: ChatMessage, markers: ChatMessage[]): ChatMessage {
  let sequence = message.activitySequence;
  if (!sequence?.length) return message;
  for (const marker of markers) {
    if (marker.execution?.assistantId !== message.id || marker.type !== 'compact-marker'
      || sequence.some(item => item.kind === 'compact' && item.markerId === marker.id)) continue;
    const boundary: ExecutionBoundary = { kind: 'compact', markerId: marker.id,
      toolOffset: marker.execution.toolOffset, timestamp: marker.timestamp,
      ...(marker.execution.reasoningOffset !== undefined ? { reasoningOffset: marker.execution.reasoningOffset } : {}) };
    sequence = insertBoundary(sequence, boundary, marker.execution.textOffset);
  }
  return sequence === message.activitySequence ? message : { ...message, activitySequence: sequence };
}

function insertBoundary(sequence: ChatActivity[], boundary: ExecutionBoundary, textOffset?: number): ChatActivity[] {
  let characters = 0;
  let tools = 0;
  for (let index = 0; index < sequence.length; index++) {
    const item = sequence[index];
    if (item.kind === 'compact') continue;
    const reached = tools >= boundary.toolOffset && (textOffset === undefined || characters >= textOffset);
    if (reached && !(item.kind === 'team' && Date.parse(item.event.timestamp) <= Date.parse(boundary.timestamp))) {
      return [...sequence.slice(0, index), boundary, ...sequence.slice(index)];
    }
    if (item.kind === 'tool') tools++;
    if (item.kind !== 'text') continue;
    if (textOffset !== undefined && tools >= boundary.toolOffset
      && characters < textOffset && characters + item.content.length > textOffset) {
      const offset = textOffset - characters;
      return [...sequence.slice(0, index), { kind: 'text', content: item.content.slice(0, offset) }, boundary,
        ...(offset < item.content.length ? [{ kind: 'text' as const, content: item.content.slice(offset) }] : []),
        ...sequence.slice(index + 1)];
    }
    characters += item.content.length;
  }
  return [...sequence, boundary];
}

/** Hide a standalone divider only when a matching assistant can render its exact boundary inline. */
export function executionCompactions(messages: ChatMessage[]): {
  byAssistant: Map<string, ChatMessage[]>; inlineMarkerIds: Set<string>;
} {
  const byAssistant = new Map<string, ChatMessage[]>();
  const inlineMarkerIds = new Set<string>();
  const assistants = new Map(messages.filter(message => message.role === 'assistant')
    .map(message => [message.id, message]));
  for (const marker of messages) {
    const execution = marker.type === 'compact-marker' ? marker.execution : undefined;
    const assistant = execution && assistants.get(execution.assistantId);
    if (!execution || !assistant?.activitySequence?.length
      || execution.toolOffset > (assistant.toolSteps?.length ?? 0)) continue;
    const markers = byAssistant.get(execution.assistantId) ?? [];
    markers.push(marker);
    byAssistant.set(execution.assistantId, markers);
    inlineMarkerIds.add(marker.id);
  }
  return { byAssistant, inlineMarkerIds };
}
