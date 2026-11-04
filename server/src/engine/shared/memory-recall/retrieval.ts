import { embedTexts } from '../../../model-runtime/embeddings.js';
import { openVectorIndex } from './vector-index.js';
import type { RecallRecord, RecallSources } from './contracts.js';

export function lexicalScore(query: string, text: string): number {
  return lexicalMatcher(query)(text);
}
function lexicalMatcher(query: string): (text: string) => number {
  const words = query.toLowerCase().match(/[a-z0-9_./:-]{2,}|[\p{Script=Han}]+/gu) ?? [];
  const tokens = new Set(words.flatMap(word => /\p{Script=Han}/u.test(word)
    ? Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2)) : [word]));
  const matches = [...tokens].map(token => {
    if (/\p{Script=Han}/u.test(token)) return (text: string) => text.includes(token);
    const pattern = new RegExp(`(?<![a-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_])`);
    return (text: string) => pattern.test(text);
  });
  return text => {
    if (!tokens.size) return 0;
    const hay = text.toLowerCase();
    let hits = 0;
    for (const match of matches) if (match(hay)) hits++;
    return hits / tokens.size;
  };
}
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  const dot = a.reduce((sum, n, i) => sum + n * b[i], 0);
  return dot / Math.sqrt(a.reduce((sum, n) => sum + n * n, 0) * b.reduce((sum, n) => sum + n * n, 0));
}
export interface RecallSearch { query: string; kind?: 'memory' | 'work'; date?: string; sequence?: number; sessionId?: string; limit?: number; offset?: number; category?: string; status?: 'all' | 'active' | 'archived' }
export interface RecallSearchResult {
  records: RecallRecord[]; scores: Record<string, number>; embeddingError?: string; indexIncomplete?: boolean;
  queryVector?: number[];
  total?: number; nextOffset?: number;
}
export async function searchRecall(dataDir: string, agentId: string, sources: RecallSources, request: RecallSearch,
  options: { embeddingModel?: string | null; signal?: AbortSignal; indexMode?: 'cached'; timeoutMs?: number; candidates?: boolean; includeArchived?: boolean } = {}): Promise<RecallSearchResult> {
  if (request.query.length > 1200 || (request.limit !== undefined
    && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 20))) throw new Error('RECALL_QUERY_INVALID');
  if (request.offset !== undefined && (!Number.isSafeInteger(request.offset) || request.offset < 0)) throw new Error('RECALL_QUERY_INVALID');
  const all = (await sources.list(agentId)).filter(record => (options.includeArchived || !record.archived) && (!request.kind || record.kind === request.kind)
    && (!request.category || record.category === request.category)
    && (!request.status || request.status === 'all' || !!record.archived === (request.status === 'archived'))
    && (!request.date || record.date === request.date) && (!request.sequence || record.sequence === request.sequence)
    && (!request.sessionId || record.sessionId === request.sessionId));
  options.signal?.throwIfAborted();
  const match = lexicalMatcher(request.query);
  const ranked = all.map(record => { const score = match(`${record.title} ${record.summary}`); return { record, score, relevance: score }; })
    .sort((a, b) => b.score - a.score || b.record.timestamp.localeCompare(a.record.timestamp));
  let embeddingError: string | undefined;
  let queryVector: number[] | undefined;
  let indexIncomplete = false;
  if (options.embeddingModel && all.length && request.query.trim()) {
    try {
      const deadline = AbortSignal.timeout(options.timeoutMs ?? 15_000);
      const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
      const index = await openVectorIndex(dataDir, agentId, options.embeddingModel);
      const missing = ranked.filter(item => !index.has(item.record));
      indexIncomplete = missing.length > (options.indexMode === 'cached' ? 0 : 64);
      if (options.indexMode !== 'cached') await index.add(missing.slice(0, 64).map(item => item.record), signal);
      const available = ranked.filter(item => index.has(item.record));
      if (available.length) {
        const [query] = await embedTexts(dataDir, options.embeddingModel, [request.query], signal);
        queryVector = query;
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(8, available.length) }, async () => {
          while (cursor < available.length) {
            signal.throwIfAborted();
            const item = available[cursor++], vector = await index.read(item.record);
            const similarity = vector ? cosine(query, vector) : 0;
            if (similarity >= .68) item.score = Math.max(item.score, similarity);
            item.relevance = Math.max(item.relevance, similarity);
          }
        }));
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      embeddingError = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'EMBEDDING_UNAVAILABLE';
    }
  }
  const score = (item: typeof ranked[number]) => options.candidates ? item.relevance : item.score;
  const matches = ranked.filter(item => !request.query.trim() || (options.candidates ? item.relevance > 0 : item.score >= .12)
    || !!request.date || !!request.sequence || !!request.sessionId)
    .sort((a, b) => score(b) - score(a) || b.record.timestamp.localeCompare(a.record.timestamp) || a.record.id.localeCompare(b.record.id));
  const offset = request.offset ?? 0;
  const ordered = options.candidates ? diversifyCandidates(matches) : matches;
  const selected = ordered.slice(offset, offset + (request.limit ?? 12));
  return { total: matches.length, ...(offset + selected.length < matches.length ? { nextOffset: offset + selected.length } : {}), records: selected.map(item => item.record), scores: Object.fromEntries(selected.map(item => [item.record.id, item.score])),
    ...(queryVector ? { queryVector } : {}),
    ...(embeddingError ? { embeddingError } : {}), ...(indexIncomplete ? { indexIncomplete } : {}) };
}

/** Spread automatic/helper candidates across source sessions and days; explicit search keeps relevance order. */
function diversifyCandidates<T extends { record: RecallRecord }>(ranked: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of ranked) {
    const record = item.record;
    const key = record.kind === 'work' && record.sessionId
      ? `work:${record.sessionId}:${record.date ?? record.timestamp.slice(0, 10)}` : record.id;
    const group = groups.get(key) ?? [];
    group.push(item); groups.set(key, group);
  }
  const result: T[] = [];
  const buckets = [...groups.values()];
  for (let index = 0; result.length < ranked.length; index++) {
    for (const group of buckets) if (group[index]) result.push(group[index]);
  }
  return result;
}
