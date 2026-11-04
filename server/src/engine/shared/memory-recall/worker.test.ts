import assert from 'node:assert/strict';
import test from 'node:test';
import { runRecallWorker } from './worker.js';
import { recallCard } from './cards.js';
import { FrameworkError, frameworkError } from '../framework-error.js';
import type { RecallSources, RecallDocument } from './contracts.js';

const document: RecallDocument = { id: 'memory:style', kind: 'memory', agentId: 'a', title: '气旋代码风格',
  summary: '保持功能岛独立', content: '界面对齐控制台，实现保留在气旋内。', revision: 'v1', timestamp: '2026-10-31T00:00:00Z' };
const sources: RecallSources = { sync: async () => {}, list: async () => [document], read: async (owner, id) =>
  owner === 'a' && id === document.id ? document : null };
const input = { dataDir: 'unused', scope: { agentId: 'a', sessionId: 's' }, query: '修改气旋卡片',
  candidates: [{ ...document, excerpt: document.content }], sources, model: 'sample:recall', signal: new AbortController().signal };
const memory = (source = document, level: 'L1' | 'L2' = 'L2', text = source.content) => ({ id: source.id, level, text });
const answer = (memories = [memory()]) => ({ content: JSON.stringify({ memories }), finishReason: 'stop' as const });

test('a missing current state can be found by follow-up search and reading without repeating identical lookups', async () => {
  const latest = { ...document, id: 'memory:current', title: '并行浏览器当前方案', content: '现采用技能封装，旧独立工具已替换。' };
  let searches = 0, calls = 0;
  const catalog: RecallSources = { sync: async () => {}, list: async () => { searches++; return [latest]; },
    read: async (_owner, id) => id === latest.id ? latest : null };
  const search = JSON.stringify({ type: 'tool_call', name: 'recall_search', arguments: { query: '并行浏览器' } });
  const result = await runRecallWorker({ ...input, query: '接着讨论并行浏览器', sources: catalog }, async params => {
    if (calls === 2) assert.match(JSON.stringify(params.messages), /reused/);
    return { content: [search, search,
      JSON.stringify({ type: 'tool_call', name: 'recall_read', arguments: { id: latest.id } }),
      answer([memory(latest)]).content][calls++], finishReason: 'stop' };
  });
  assert.equal(searches, 1);
  assert.equal(calls, 4);
  assert.equal(result.cards[0].id, latest.id);
  assert.equal(result.cards[0].text, latest.content);
});

test('secondary recall can finish from previews in one call, with optional search and reads for missing detail', async () => {
  let calls = 0;
  const immediate = await runRecallWorker(input, async () => { calls++; return answer(); });
  assert.equal(calls, 1); assert.equal(immediate.cards[0].text, document.content);
  calls = 0;
  const found = await runRecallWorker({ ...input, candidates: [] }, async args => {
    assert.equal(args.purpose, 'memory-recall');
    return { content: ['{"type":"tool_call","name":"recall_search","arguments":{"query":"气旋"}}',
      '{"type":"tool_call","name":"recall_read","arguments":{"id":"memory:style"}}', answer().content][calls++], finishReason: 'stop' };
  });
  assert.equal(calls, 3); assert.equal(found.cards[0].text, document.content);
});

test('one malformed-format correction does not repeat prior tool reads; a second failure remains visible', async () => {
  let calls = 0, reads = 0;
  const found = await runRecallWorker({ ...input, sources: { ...sources, read: async () => { reads++; return document; } } },
    async () => ({ content: ['{"type":"tool_call","name":"recall_read","arguments":{"id":"memory:style"}}',
      'not json', answer().content][calls++], finishReason: 'stop' }));
  assert.equal(calls, 3); assert.equal(reads, 2); assert.equal(found.cards.length, 1);
  calls = 0;
  await assert.rejects(runRecallWorker(input, async () => { calls++; return { content: '{}', finishReason: 'stop' }; }),
    error => error instanceof FrameworkError && error.data.code === 'MEMORY_RECALL_OUTPUT_INVALID');
  assert.equal(calls, 2);
});

test('a mixed character record supplies only its useful method, allowing a concise reminder without passage IDs or reasons', async () => {
  const other = { ...document, content: '角色乙有鱼尾。\n\n通用方法：固定特征与逐图动作分别核对。\n\n旧任务：修改乙的全部文件。' };
  const result = await runRecallWorker({ ...input, currentMessage: '给角色甲调整打标结构',
    candidates: [{ ...other, excerpt: other.content }], sources: { ...sources, read: async () => other } },
    async () => answer([memory(other, 'L2', '打标时分开核对固定特征和逐图动作。')]));
  assert.equal(result.cards[0].text, '打标时分开核对固定特征和逐图动作。');
  assert.ok(!result.cards[0].text.includes('鱼尾'));
  assert.deepEqual((await runRecallWorker(input, async () => answer([]))).cards, []);
});

test('two indexed and six secondary sources retain independent quotas, and invalid items do not discard valid reminders', async () => {
  const documents = Array.from({ length: 9 }, (_, i) => ({ ...document, id: `memory:part-${i}`, content: `项目约束第${i}项。` }));
  const catalog: RecallSources = { sync: async () => {}, list: async () => documents,
    read: async (_owner, id) => documents.find(d => d.id === id) ?? null };
  const selected = documents.map((d, i) => memory(d, i < 2 ? 'L1' : 'L2'));
  const found = await runRecallWorker({ ...input, sources: catalog, candidates: documents.map(d => ({ ...d, excerpt: d.content })),
    level1Candidates: documents.slice(0, 2).map(d => recallCard(d, d.content, 'L1')) },
    async () => ({ content: JSON.stringify({ memories: [{ id: 'invented', text: 'bad' }, ...selected, selected[0]] }), finishReason: 'stop' }));
  assert.equal(found.cards.filter(c => c.level === 'L1').length, 2); assert.equal(found.cards.filter(c => c.level === 'L2').length, 6);
});

test('removed, revised, archived or foreign-owner sources are excluded without injecting whole records', async () => {
  for (const current of [null, { ...document, revision: 'v2' }, { ...document, archived: true }, { ...document, agentId: 'other' }]) {
    assert.deepEqual((await runRecallWorker({ ...input, sources: { ...sources, read: async () => current } }, async () => answer())).cards, []);
  }
});

test('provider errors and cancellation cannot return recalled cards', async () => {
  const failure = frameworkError({ code: 'MODEL_ACCESS_DENIED', kind: 'permission', message: 'denied', source: 'provider', retryable: false });
  await assert.rejects(runRecallWorker(input, async () => { throw failure; }), error => error instanceof FrameworkError && error.data.code === failure.data.code);
  const controller = new AbortController();
  await assert.rejects(runRecallWorker({ ...input, signal: controller.signal,
    sources: { ...sources, read: async () => { controller.abort(); return document; } } }, async () => answer()), /abort/i);
});
