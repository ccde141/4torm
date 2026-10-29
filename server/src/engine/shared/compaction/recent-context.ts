import type { ContextMessage } from '../types.js';
import { isHumanContextMessage } from '../context-origin.js';
import { estimateMessageTokens } from './estimate.js';

export const RECENT_CONTEXT_TOKENS = 30_000;

/** A human turn includes every reply and tool result until the next human input. */
export function recentContextStart(messages: readonly ContextMessage[], start: number, turns: 3 | 4): number {
  let remaining = turns;
  for (let index = messages.length - 1; index >= start; index--) {
    if (isHumanContextMessage(messages[index]) && --remaining === 0) return index;
  }
  let tokens = 0;
  for (let index = messages.length - 1; index >= start; index--) {
    tokens += estimateMessageTokens(messages[index]);
    if (tokens >= RECENT_CONTEXT_TOKENS) return index;
  }
  return start;
}
