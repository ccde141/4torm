import type { ContextMessage } from '../../../engine/shared/types.js';
import type { ConvectionMessage } from '../infrastructure/session-store.js';

/** Speaker records stay separate so token splitting can respect human round boundaries. */
export function convectionContext(messages: readonly ConvectionMessage[]): ContextMessage[] {
  return messages.map(message => ({ role: 'user', content: `[${message.speaker}] ${message.content}` }));
}

export function convectionRoundBoundaries(
  context: readonly ContextMessage[], records: readonly ConvectionMessage[],
): number[] {
  const boundaries: number[] = [];
  records.forEach((message, index) => {
    if (index > 0 && message.speaker === '人类') boundaries.push(index + 1);
  });
  for (let index = records.length + 1; index <= context.length; index++) {
    if (index === context.length || context[index]?.role === 'user'
      || context[index - 1]?.role === 'tool') boundaries.push(index);
  }
  return boundaries;
}
