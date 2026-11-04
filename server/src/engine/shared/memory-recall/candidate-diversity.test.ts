import assert from 'node:assert/strict';
import test from 'node:test';
import { searchRecall } from './retrieval.js';
import type { RecallRecord, RecallSources } from './contracts.js';

test('helper candidates retain related sources from other sessions and days while explicit ranking stays stable', async () => {
  const records: RecallRecord[] = Array.from({ length: 25 }, (_, index) => ({
    id: `work:${index}`, kind: 'work', agentId: 'a', sessionId: 'first', date: '2026-11-03',
    timestamp: '2026-11-03T12:00:00Z', title: '浏览器方案', summary: '浏览器方案', revision: 'v1',
  }));
  records.push({ ...records[0], id: 'work:other-session', sessionId: 'second', timestamp: '2026-11-02T00:00:00Z', date: '2026-11-02' },
    { ...records[0], id: 'work:other-day', timestamp: '2026-11-01T00:00:00Z', date: '2026-11-01' },
    { ...records[0], id: 'work:irrelevant', sessionId: 'unrelated', title: '税务资料', summary: '税务资料' });
  const sources: RecallSources = { sync: async () => {}, list: async () => records, read: async () => null };
  const request = { query: '浏览器方案', limit: 3 };
  const initial = await searchRecall('unused', 'a', sources, request, { candidates: true });
  assert.ok(initial.records.some(record => record.id === 'work:other-session'));
  assert.ok(initial.records.some(record => record.id === 'work:other-day'));
  assert.ok(!initial.records.some(record => record.id === 'work:irrelevant'));
  const explicit = await searchRecall('unused', 'a', sources, request);
  assert.ok(explicit.records.every(record => record.sessionId === 'first'));
  const next = await searchRecall('unused', 'a', sources, { ...request, offset: 3 }, { candidates: true });
  assert.ok(next.records.every(record => !initial.records.some(prior => prior.id === record.id)));
});
