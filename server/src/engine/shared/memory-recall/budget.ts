import { estimateTextTokens } from '../compaction/estimate.js';
import type { RecallCard } from './contracts.js';

export const RECALL_LIMITS = {
  L1: { cards: 2, tokens: 2000 },
  L2: { cards: 6, tokens: 8000 },
} as const;
export const MAX_RECALL_CARDS = RECALL_LIMITS.L1.cards + RECALL_LIMITS.L2.cards;
export const MAX_PENDING_RECALL_CARDS = MAX_RECALL_CARDS * 3;
export const MAX_RECALL_TEXT_LENGTH = RECALL_LIMITS.L2.tokens * 4;

/** Preserve complete paragraphs when possible; a single oversized paragraph becomes an excerpt. */
export function fitRecallText(text: string, tokens: number): string {
  if (tokens <= 0) return '';
  if (estimateTextTokens(text) <= tokens) return text;
  let low = 0, high = Math.min(text.length, tokens * 4);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTextTokens(text.slice(0, middle)) <= tokens) low = middle;
    else high = middle - 1;
  }
  const prefix = text.slice(0, low).replace(/[\uD800-\uDBFF]$/, '');
  const paragraph = prefix.lastIndexOf('\n\n');
  if (paragraph >= prefix.length / 2) return prefix.slice(0, paragraph).trimEnd();
  const end = [...prefix.matchAll(/[。！？.!?](?:\s|$)|\n/g)].at(-1);
  return end && end.index + end[0].length >= prefix.length / 2
    ? prefix.slice(0, end.index + end[0].length).trimEnd() : prefix.trimEnd();
}

export function recallCardTokens(card: RecallCard): number { return estimateTextTokens(JSON.stringify(card)); }

export function fitRecallCard(card: RecallCard, tokens: number): RecallCard | null {
  let text = fitRecallText(card.text, tokens - recallCardTokens({ ...card, text: '' }) - 8);
  while (text.trim()) {
    const fitted = { ...card, text }, excess = recallCardTokens(fitted) - tokens;
    if (excess <= 0) return fitted;
    text = fitRecallText(text, estimateTextTokens(text) - excess - 8);
  }
  return null;
}
