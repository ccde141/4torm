import type { ContextMessage } from '../types.js';
import { isHumanContextMessage } from '../context-origin.js';

/** Project reference placement without rewriting canonical history or splitting tool call/result pairs. */
export function placeFrameworkReferences(messages: ContextMessage[]): ContextMessage[] {
  const ordered: ContextMessage[] = [];
  let human: ContextMessage | undefined;
  for (const message of messages) {
    if (isHumanContextMessage(message)) human = message;
    if (message.origin === 'framework' && message.placement === 'before-human') {
      if (!message.content) continue;
      const index = human ? ordered.indexOf(human) : -1;
      if (index >= 0) { ordered.splice(index, 0, message); continue; }
    }
    ordered.push(message);
  }
  return ordered;
}
