import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverRecallCards, RECALL_PREFIX } from './delivery.js';
import { recallCard } from './cards.js';
import { RECALL_LIMITS, recallCardTokens } from './budget.js';
import type { RecallDocument, RecallSources } from './contracts.js';
import type { ContextMessage } from '../types.js';
import { formatTextToolCall, formatTextToolResult } from '../text-tool-protocol.js';

const source: RecallDocument = { id: 'memory:style', agentId: 'a', kind: 'memory', title: '青禾界面偏好',
  summary: '青禾轻玻璃卡片', revision: 'v1', timestamp: '2026-11-01T00:00:00Z', content: '青禾使用轻玻璃卡片。' };
const sources: RecallSources = { sync: async () => {}, list: async () => [source],
  read: async (owner, id) => owner === 'a' && id === source.id ? source : null };
const card = recallCard(source, source.content, 'L1');
const deliver = (context: ContextMessage[]) => deliverRecallCards('a', sources, '青禾界面偏好', context, [card, card]);

test('successful native or text memory reads suppress duplicate automatic delivery', async () => {
  const content = `## ${source.title}\n${source.content}`;
  const native: ContextMessage[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'memory_read', arguments: '{"slug":"style"}' }] },
    { role: 'tool', toolCallId: 'c', content, toolOk: true },
  ];
  const text: ContextMessage[] = [
    { role: 'assistant', content: formatTextToolCall('memory_read', { slug: 'style' }) },
    { role: 'user', origin: 'framework', content: formatTextToolResult('memory_read', content, true) },
  ];
  assert.deepEqual(await deliver(native), []); assert.deepEqual(await deliver(text), []);
  native[1].toolOk = false;
  assert.equal((await deliver(native)).length, 1);
  assert.equal((await deliver([])).length, 1); // Compacted-away reads do not suppress future useful recall.
});

test('only complete matching source revisions and framework receipts suppress automatic delivery', async () => {
  const read = (revision: string, hasMore: boolean): ContextMessage[] => [
    { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'recall_read', arguments: '{"id":"memory:style"}' }] },
    { role: 'tool', toolCallId: 'c', toolOk: true,
      content: JSON.stringify({ source: { ...source, revision }, offset: 0, hasMore, content: source.content }) },
  ];
  assert.deepEqual(await deliver(read('v1', false)), []);
  assert.equal((await deliver(read('old', false))).length, 1);
  assert.equal((await deliver(read('v1', true))).length, 1);
  const content = RECALL_PREFIX + JSON.stringify({ records: [card] });
  assert.deepEqual(await deliver([{ role: 'user', origin: 'framework', content }]), []);
  assert.equal((await deliver([{ role: 'user', origin: 'human', content }])).length, 1);
});

test('a current semantic match is not discarded by a second keyword-only filter', async () => {
  const query = 'translucent panels';
  assert.deepEqual(await deliverRecallCards('a', sources, query, [], [card]), []);
  const selected = await deliverRecallCards('a', sources, query, [], [card], undefined, new Set([`${card.id}:${card.revision}`]));
  assert.equal(selected.length, 1); assert.equal(selected[0].text, source.content);
});

test('Level 1 and Level 2 have independent source counts and token budgets', async () => {
  const documents = Array.from({ length: 16 }, (_, i) => ({ ...source, id: `memory:budget-${i}`,
    content: '完整项目背景与约束。'.repeat(110) }));
  const catalog: RecallSources = { sync: async () => {}, list: async () => documents,
    read: async (_agent, id) => documents.find(document => document.id === id) ?? null };
  const cards = documents.map((document, i) => recallCard(document, document.content, i < 8 ? 'L1' : 'L2'));
  const matches = new Set(cards.map(card => `${card.id}:${card.revision}`));
  const both = await deliverRecallCards('a', catalog, '项目约束', [], cards, undefined, matches);
  const first = await deliverRecallCards('a', catalog, '项目约束', [], cards.filter(card => card.level === 'L1'), undefined, matches);
  for (const level of ['L1', 'L2'] as const) {
    const selected = both.filter(card => card.level === level);
    assert.equal(selected.length, RECALL_LIMITS[level].cards);
    assert.ok(selected.reduce((total, card) => total + recallCardTokens(card), 0) <= RECALL_LIMITS[level].tokens);
  }
  assert.deepEqual(both.filter(card => card.level === 'L1'), first);
  assert.ok(both.some(card => card.level === 'L2' && card.text.length > 900));
});

test('automatic recall keeps source-version deduplication until that reference leaves active context', async () => {
  const document = { ...source, content: `${'早期项目背景。'.repeat(160)}\n\n关键后半段：当前交付与剩余事项。` };
  const catalog: RecallSources = { ...sources, read: async () => document };
  const prefix = recallCard(document, document.content.slice(0, 900), 'L1');
  const reference = (records: typeof card[]): ContextMessage => ({ role: 'user', origin: 'framework',
    content: RECALL_PREFIX + JSON.stringify({ records }) });
  const context = [reference([prefix])];
  const selected = await deliverRecallCards('a', catalog, '青禾界面偏好', context,
    [recallCard(document, document.content, 'L2')]);
  assert.deepEqual(selected, []);
  assert.equal((await deliverRecallCards('a', catalog, '青禾界面偏好', [], [recallCard(document, document.content, 'L2')])).length, 1);
});
