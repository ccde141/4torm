import type { ChatMessage } from '../../../types';

/** Stable server IDs reconcile an early SSE event, an ACK and any local optimistic row. */
export function mergeNodeUserMessage(messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  return messages.some(message => message.id === incoming.id) ? messages : [...messages, incoming];
}
