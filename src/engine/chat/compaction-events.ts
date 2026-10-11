import type { ChatMessage } from '../../types';
import type { MonsoonBrowserEvent } from './sse-events';

export function clearCompactionNotices(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => {
    if (!message.compactionNotice) return message;
    const { compactionNotice: _notice, ...rest } = message;
    return rest;
  });
}

/** A persisted checkpoint supplies the revision for the eventual reply save. */
export function compactionCheckpoint(event: MonsoonBrowserEvent): {
  marker: ChatMessage; revision: number;
} {
  const marker: unknown = event.marker;
  if (!Number.isSafeInteger(event.revision) || event.revision < 0 || !isRecord(marker)
    || typeof marker.id !== 'string' || typeof marker.content !== 'string'
    || typeof marker.timestamp !== 'string' || marker.role !== 'system'
    || marker.type !== 'compact-marker' || marker.contextExact !== true
    || !Array.isArray(marker.nativeContext) || !marker.nativeContext.every(validContext)) {
    throw new Error('压缩检查点不是有效的会话协议');
  }
  return { marker: marker as unknown as ChatMessage, revision: event.revision };
}

function validContext(value: unknown): boolean {
  return isRecord(value) && ['system', 'user', 'assistant', 'tool'].includes(String(value.role))
    && typeof value.content === 'string'
    && (value.toolCalls === undefined || (Array.isArray(value.toolCalls)
      && value.toolCalls.every(call => isRecord(call) && typeof call.id === 'string'
        && typeof call.name === 'string' && typeof call.arguments === 'string')));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
