import { cosine, lexicalScore, type RecallSearchResult } from './retrieval.js';
import { recallHash } from './storage.js';
import type { ContextMessage } from '../types.js';
import type { RecallSessionState } from './contracts.js';

type Reflection = NonNullable<RecallSessionState['reflection']>;
export function reflectionSnapshot(query: string, context: ContextMessage[], result: RecallSearchResult): Reflection {
  const summary = [...context].reverse().find(message => message.role === 'system' && /^\[历史/.test(message.content));
  return { query, candidates: result.records.slice(0, 5).map(record => `${record.id}:${record.revision}`),
    compact: summary ? recallHash(summary.content) : '', ...(result.queryVector ? { vector: result.queryVector } : {}) };
}

/** Cheap signals only; the recall model is not used as a per-message topic classifier. */
export function needsReflection(previous: Reflection | undefined, current: Reflection): boolean {
  if (!previous || previous.compact !== current.compact) return true;
  if (/^(?:继续|接着|下一步|好的?|嗯+|continue|go on)[。！？!?\s]*$/i.test(current.query)) return false;
  if (current.vector && previous.vector && cosine(current.vector, previous.vector) < .8) return true;
  const overlap = current.candidates.filter(id => previous.candidates.includes(id)).length;
  if (current.candidates.length && overlap === 0) return true;
  if (overlap >= Math.ceil(current.candidates.length / 2) && overlap > 0) return false;
  if (current.query === previous.query) return false;
  return lexicalScore(current.query, previous.query) < .3 && lexicalScore(previous.query, current.query) < .3;
}
