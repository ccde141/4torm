import type { RecallCard, RecallRecord, RecallSources } from './contracts.js';
import type { RecallSearchResult } from './retrieval.js';
import { fitRecallText, RECALL_LIMITS } from './budget.js';

/** Materialize a bounded source excerpt; neither selection path invents a new memory. */
export function recallCard(source: RecallRecord, text: string, level: RecallCard['level']): RecallCard {
  const budget = RECALL_LIMITS[level];
  return { id: source.id, revision: source.revision, level,
    text: fitRecallText(text, level === 'L1' ? budget.tokens / budget.cards : budget.tokens),
    title: source.title, kind: source.kind, sessionId: source.sessionId, date: source.date, sequence: source.sequence,
    scope: source.scope, timestamp: source.timestamp, sourceId: source.sourceId, sourceRevision: source.sourceRevision };
}

export async function selectIndexedCards(agentId: string, sources: RecallSources,
  result: RecallSearchResult, signal: AbortSignal): Promise<{ cards: RecallCard[] }> {
  const cards: RecallCard[] = [];
  // Model-free recall only delivers stronger matches, keeping broad discovery in explicit search tools.
  for (const record of result.records.filter(record => result.scores[record.id] >= .5).slice(0, RECALL_LIMITS.L1.cards)) {
    signal.throwIfAborted();
    const document = await sources.read(agentId, record.id);
    if (document?.revision === record.revision) cards.push(recallCard(document, document.content, 'L1'));
  }
  return { cards };
}
