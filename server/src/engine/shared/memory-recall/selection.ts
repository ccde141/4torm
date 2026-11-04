import { frameworkError } from '../framework-error.js';
import { fitRecallCard, RECALL_LIMITS } from './budget.js';
import { recallCard } from './cards.js';
import { recallObject } from './storage.js';
import type { RecallCard, RecallRecord, RecallSources } from './contracts.js';

/** A small helper response supplies the useful reminder, not a full-record fallback or a quotation protocol. */
export async function selectModelMemories(content: string, known: Map<string, RecallRecord>, level1: RecallCard[],
  agentId: string, sources: RecallSources, signal: AbortSignal): Promise<RecallCard[]> {
  let value: unknown;
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')); }
  catch { throw invalidSelection(); }
  if (!recallObject(value) || !Array.isArray(value.memories)) throw invalidSelection();
  const cards: RecallCard[] = [], ids = new Set<string>(), counts = { L1: 0, L2: 0 };
  let malformed = false;
  for (const item of value.memories.slice(0, 20)) {
    if (!recallObject(item) || typeof item.id !== 'string' || ids.has(item.id)
      || typeof item.text !== 'string' || !item.text.trim() || !known.has(item.id)) { malformed = true; continue; }
    const level = item.level === 'L1' ? 'L1' : 'L2';
    if (level === 'L1' && !level1.some(card => card.id === item.id)) { malformed = true; continue; }
    if (counts[level] >= RECALL_LIMITS[level].cards) continue;
    signal.throwIfAborted();
    const source = await sources.read(agentId, item.id);
    signal.throwIfAborted();
    if (!source || source.archived || source.agentId !== agentId || source.revision !== known.get(item.id)?.revision) continue;
    const card = fitRecallCard(recallCard(source, item.text.trim(), level),
      Math.floor(RECALL_LIMITS[level].tokens / Math.max(1, Math.min(RECALL_LIMITS[level].cards, value.memories.length))));
    if (card) { cards.push(card); counts[level]++; ids.add(item.id); }
  }
  if (!cards.length && malformed) throw invalidSelection();
  return cards;
}
function invalidSelection() { return frameworkError({ code: 'MEMORY_RECALL_OUTPUT_INVALID', kind: 'protocol',
  message: '记忆召回模型未返回有效记忆清单', source: 'memory-recall', retryable: false }); }
