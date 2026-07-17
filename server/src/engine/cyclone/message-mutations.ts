import type { ContextMessage } from './types.js';

export function editContextMessage(messages: ContextMessage[], index: number, content: string): boolean {
  const message = messages[index];
  if (!message) return false;
  message.content = content;
  return true;
}

export function deleteContextMessage(messages: ContextMessage[], index: number): boolean {
  const message = messages[index];
  if (!message) return false;

  const toolCallIds = new Set(
    message.role === 'assistant' ? (message.toolCalls || []).map(call => call.id) : [],
  );
  messages.splice(index, 1);
  if (toolCallIds.size > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const toolCallId = messages[i].toolCallId;
      if (messages[i].role === 'tool' && toolCallId && toolCallIds.has(toolCallId)) {
        messages.splice(i, 1);
      }
    }
  }
  return true;
}
