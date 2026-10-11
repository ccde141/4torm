import type { ContextMessage } from '../../../engine/shared/types.js';
import type { TideMessage } from './session-types.js';

/** Raw records remain in the session; only this projection is supplied to the model. */
export function activeTideContext(messages: readonly TideMessage[]): ContextMessage[] {
  let active: ContextMessage[] = [];
  for (const message of messages) {
    if (message.contextOmitted) continue;
    if (message.type === 'compact-marker' && message.nativeContext) {
      active = structuredClone(message.nativeContext);
      continue;
    }
    if (message.role === 'user' || message.role === 'assistant' || message.role === 'system') {
      active.push({ role: message.role, content: message.content });
    } else if (message.role === 'tool-call' || message.role === 'tool-result') {
      active.push({ role: 'user', content: `[已记录的 ${message.role}]\n${message.content}` });
    }
  }
  return active;
}
