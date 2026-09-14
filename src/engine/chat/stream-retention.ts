import type { ChatMessage } from '../../types';

export function markObservation(message: ChatMessage): ChatMessage {
  const offset = message.reasoningContent?.length ?? 0;
  if (!offset || message.reasoningBreaks?.includes(offset)) return message;
  return { ...message, reasoningBreaks: [...(message.reasoningBreaks ?? []), offset] };
}

/** Keep received evidence; stopping a stream does not undo tool side effects. */
export function retainStopped(messages: ChatMessage[], id: string): ChatMessage[] {
  return messages.map(message => message.id === id ? {
    ...message, streamStopped: true, streamingPhase: undefined, streamingStatus: undefined,
    streamingTool: undefined, streamingArgumentChars: undefined, phaseElapsed: undefined,
  } : message);
}

export function reasoningSegments(content: string, breaks?: number[]): string[] {
  const offsets = [...new Set((breaks ?? []).filter(offset => Number.isInteger(offset) && offset > 0 && offset < content.length))].sort((a, b) => a - b);
  return [0, ...offsets].map((start, index) => content.slice(start, offsets[index] ?? content.length));
}
