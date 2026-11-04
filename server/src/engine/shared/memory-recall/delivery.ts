import type { ContextMessage } from '../types.js';
import type { RecallCard, RecallSources } from './contracts.js';
import { lexicalScore } from './retrieval.js';
import { recallObject } from './storage.js';
import { parseTextToolResponse, parseTextToolResult } from '../text-tool-protocol.js';
import { fitRecallCard, recallCardTokens, RECALL_LIMITS } from './budget.js';
import { MEMORY_REFERENCE_NOTE } from '../memory-guidance.js';

export const RECALL_PREFIX = '[框架记忆参考]\n';
export const RECALL_NOTE = MEMORY_REFERENCE_NOTE;

/** Recheck persisted references against owner facts on every model boundary, including after history edits. */
export async function sanitizeRecallReferences(agentId: string, sources: RecallSources, context: ContextMessage[]): Promise<void> {
  for (const message of context) {
    if (message.origin !== 'framework' || !message.content.startsWith(RECALL_PREFIX)) continue;
    try {
      const payload: unknown = JSON.parse(message.content.slice(RECALL_PREFIX.length));
      if (!recallObject(payload) || !Array.isArray(payload.records)) { message.content = ''; continue; }
      const records = [];
      for (const card of payload.records) {
        if (!recallObject(card) || typeof card.id !== 'string') continue;
        const source = await sources.read(agentId, card.id);
        if (source?.revision === card.revision) records.push(card);
      }
      message.content = records.length ? RECALL_PREFIX + JSON.stringify({ ...payload, note: RECALL_NOTE, records }) : '';
    } catch { message.content = ''; console.warn('[memory-recall] RECALL_REFERENCE_UNAVAILABLE'); }
  }
}

/** Only successful, still-present context counts as delivery; edited or compacted-away evidence does not. */
function receipts(context: ContextMessage[]) {
  const delivered = new Set<string>(), legacyReads = new Map<string, string>();
  const fragments = new Map<string, string[]>();
  const calls = new Map(context.flatMap(message => (message.toolCalls ?? []).map(call => [call.id, call] as const)));
  const textCalls = new Map<string, Record<string, unknown>>();
  for (const message of context) {
    if (message.role === 'assistant') {
      const parsed = parseTextToolResponse(message.content);
      if (parsed.kind === 'tool-call') textCalls.set(parsed.name, parsed.arguments);
    }
    try {
      if (message.role === 'user' && message.origin === 'framework' && message.content.startsWith(RECALL_PREFIX)) {
        const payload = JSON.parse(message.content.slice(RECALL_PREFIX.length));
        for (const card of payload.records ?? []) if (card?.id && card?.revision && typeof card.text === 'string') {
          const key = `${card.id}:${card.revision}`;
          delivered.add(key);
          fragments.set(key, [...(fragments.get(key) ?? []), card.text]);
        }
      }
      const call = message.toolCallId ? calls.get(message.toolCallId) : undefined;
      const text = message.role === 'user' && message.origin === 'framework' ? parseTextToolResult(message.content) : undefined;
      const native = message.role === 'tool' && message.toolOk !== false;
      const name = native ? call?.name : text?.ok ? text.name : undefined;
      const content = native ? message.content : text?.ok ? text.content : '';
      if (!name) continue;
      if (name === 'memory_read') {
        const args: unknown = call ? JSON.parse(call.arguments) : textCalls.get(name);
        if (recallObject(args) && typeof args.slug === 'string') legacyReads.set(`memory:${args.slug}`, content.trim());
      }
      if (name !== 'recall_read') continue;
      const body: unknown = JSON.parse(content);
      if (recallObject(body) && recallObject(body.source) && body.view !== 'source' && body.offset === 0
        && body.hasMore === false && typeof body.content === 'string') {
        delivered.add(`${body.source.id}:${body.source.revision}`);
      }
    } catch { /* Ordinary tool text and edited references are not structured delivery receipts. */ }
  }
  return { delivered, legacyReads, fragments };
}

function unseenText(text: string, previous: string[]): string {
  let remaining = text;
  for (const fragment of previous.filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (fragment.includes(remaining)) return '';
    remaining = remaining.replace(fragment, '\n\n').trim();
  }
  return remaining;
}

export async function deliverRecallCards(agentId: string, sources: RecallSources, query: string,
  context: ContextMessage[], cards: RecallCard[], signal?: AbortSignal, matched = new Set<string>()): Promise<RecallCard[]> {
  return (await selectRecallDelivery(agentId, sources, query, context, cards, signal, matched)).cards;
}

export async function selectRecallDelivery(agentId: string, sources: RecallSources, query: string,
  context: ContextMessage[], cards: RecallCard[], signal?: AbortSignal, matched = new Set<string>()) {
  const { delivered, legacyReads, fragments } = receipts(context), selected: RecallCard[] = [];
  const counts = { L1: 0, L2: 0 }, tokens = { L1: 0, L2: 0 };
  let duplicateCount = 0, unavailableCount = 0;
  const continuation = /^(继续|接着|下一步)[。！？!?\s]*$/.test(query);
  const ordered = [...cards].sort((a, b) => Number(b.level === 'L2') - Number(a.level === 'L2'));
  for (const card of ordered) {
    signal?.throwIfAborted();
    const key = `${card.id}:${card.revision}`;
    if (delivered.has(key)) { duplicateCount++; continue; }
    const limits = RECALL_LIMITS[card.level];
    if (counts[card.level] >= limits.cards) continue;
    if (!continuation && !matched.has(key) && lexicalScore(query, `${card.title} ${card.text}`) < .12) continue;
    const source = await sources.read(agentId, card.id);
    if (!source || source.archived || source.revision !== card.revision) { unavailableCount++; continue; }
    if (legacyReads.get(card.id)?.endsWith(`## ${source.title}\n${source.content}`.trim())) { duplicateCount++; continue; }
    const text = unseenText(card.text, fragments.get(key) ?? []);
    if (!text) { duplicateCount++; continue; }
    const bounded = fitRecallCard({ ...card, text }, limits.tokens - tokens[card.level]);
    if (!bounded) continue;
    selected.push(bounded); counts[card.level]++; tokens[card.level] += recallCardTokens(bounded);
    fragments.set(key, [...(fragments.get(key) ?? []), bounded.text]);
  }
  signal?.throwIfAborted();
  return { cards: selected, duplicateCount, unavailableCount };
}
