import type { ChatMessage } from '../../../types';
import type { CompactionEvent } from '../compaction-events';

/** Successful commits split display only; the running node and its tools keep their identities. */
export function nodeCompactionMarker(event: CompactionEvent): ChatMessage | undefined {
  if (event.type !== 'compact-done' || event.operation !== 'compact'
    || typeof event.summary !== 'string' || !event.summary.trim()) return;
  const time = new Date(event.updatedAt);
  return { id: event.id, role: 'system', type: 'compact-marker',
    content: `[历史压缩记录]\n${event.summary}`, timestamp: Number.isFinite(time.getTime()) ? time.toISOString() : '' };
}

export function appendNodeCompaction(messages: ChatMessage[], marker: ChatMessage): ChatMessage[] {
  return messages.some(message => message.id === marker.id) ? messages : [...messages, marker];
}

export function nodeContinuationAnswer(content: string, priorContent: string): string {
  return priorContent && content.startsWith(priorContent) ? content.slice(priorContent.length).trimStart() : content;
}
