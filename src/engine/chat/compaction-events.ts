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
    || !Array.isArray(marker.nativeContext) || !marker.nativeContext.every(validContext)
    || (marker.execution !== undefined && (!isRecord(marker.execution)
      || typeof marker.execution.assistantId !== 'string' || !marker.execution.assistantId
      || !Number.isSafeInteger(marker.execution.toolOffset) || Number(marker.execution.toolOffset) < 0
      || (marker.execution.textOffset !== undefined && (!Number.isSafeInteger(marker.execution.textOffset)
        || Number(marker.execution.textOffset) < 0))
      || (marker.execution.reasoningOffset !== undefined && (!Number.isSafeInteger(marker.execution.reasoningOffset)
        || Number(marker.execution.reasoningOffset) < 0))))) {
    throw new Error('压缩检查点不是有效的会话协议');
  }
  return { marker: marker as unknown as ChatMessage, revision: event.revision };
}

/** Only a committed checkpoint creates a display boundary; replay is idempotent. */
export function appendCompactionActivity(message: ChatMessage, marker: ChatMessage): ChatMessage {
  if (marker.execution?.assistantId !== message.id
    || message.activitySequence?.some(item => item.kind === 'compact' && item.markerId === marker.id)) return message;
  return { ...message, activitySequence: [...(message.activitySequence ?? []), {
    kind: 'compact', markerId: marker.id, toolOffset: marker.execution.toolOffset, timestamp: marker.timestamp,
    ...(marker.execution.reasoningOffset !== undefined ? { reasoningOffset: marker.execution.reasoningOffset } : {}),
  }] };
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
