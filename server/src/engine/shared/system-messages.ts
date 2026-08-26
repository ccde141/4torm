import type { ContextMessage } from './types.js';

/** Return a model context with at most one system message, always at index zero. */
export function normalizeSystemMessages(messages: ContextMessage[]): ContextMessage[] {
  const systemContent = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .filter(Boolean);
  const history = messages.filter(message => message.role !== 'system');
  if (systemContent.length === 0) return history;
  return [{ role: 'system', content: systemContent.join('\n\n') }, ...history];
}
