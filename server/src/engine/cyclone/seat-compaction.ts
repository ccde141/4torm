import { splitCompactionMessages, serializeCompactionMessages } from '../shared/compaction/index.js';
import type { SeatContextMessage } from './types.js';

export type SeatCompactionPlan = {
  ok: true;
  archivedMessages: SeatContextMessage[];
  keptMessages: SeatContextMessage[];
  summaryInput: string;
  estimatedTokens: number;
  keptTurnCount: number;
} | {
  ok: false;
  reason: 'nothing-to-compact';
  estimatedTokens: number;
  turnCount: number;
};

/** Explicit human compact summarizes all completed active history, regardless of size. */
export function planSeatCompaction(messages: SeatContextMessage[], promptTokens?: number): SeatCompactionPlan {
  const split = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 1, protectedPrefixCount: 0 });
  const estimatedTokens = promptTokens ?? split?.sourceTokens ?? 0;
  if (!split?.prefix.length) return { ok: false, reason: 'nothing-to-compact', estimatedTokens,
    turnCount: messages.filter(message => message.role === 'user').length };
  return { ok: true, archivedMessages: split.prefix, keptMessages: split.tail,
    summaryInput: serializeCompactionMessages(split.prefix), estimatedTokens,
    keptTurnCount: split.tail.filter(message => message.role === 'user').length };
}
