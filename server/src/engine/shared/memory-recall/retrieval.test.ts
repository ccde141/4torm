import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchRecall, lexicalScore } from './retrieval.js';
import { completeRecallIndex } from './vector-index.js';
import { registerCompactWork, listWorkRecords } from './work-records.js';
import { recallHash } from './storage.js';
import type { RecallSources } from './contracts.js';

test('identifier recall does not confuse a complete project code with a longer prefix match', () => {
  assert.equal(lexicalScore('ARCH999', '项目 ARCH999 归档约定'), 1);
  assert.equal(lexicalScore('ARCH999', '项目 ARCH99988 归档约定'), 0);
  assert.equal(lexicalScore('QH-37', '验收 QH-37。'), 1);
  assert.equal(lexicalScore('TypeScript', 'TypeScript 功能岛'), 1);
});

test('vector indexing is incremental, reuses cached records and respects provider batch limits', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-vectors-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'p',
    baseUrl: 'https://fixture.invalid/v1', models: ['embed'] }] }));
  const batches: string[][] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { input } = JSON.parse(String(init?.body)) as { input: string[] };
    batches.push(input);
    assert.ok(input.length <= 10);
    return Response.json({ data: input.map((text, index) => ({ index,
      embedding: /semantic query|meaning-target/.test(text) ? [1, 0] : [0, 1] })) });
  });
  const records = Array.from({ length: 66 }, (_, index) => ({ id: `work:${index}`, agentId: 'a', kind: 'work' as const,
    title: `entry-${index}`, summary: index === 65 ? 'meaning-target' : 'other material', revision: 'v1',
    timestamp: new Date(Date.UTC(2026, 9, 31, 0, 0, 66 - index)).toISOString() }));
  const sources: RecallSources = { sync: async () => {}, list: async () => records, read: async () => null };
  const find = () => searchRecall(dataDir, 'a', sources, { query: 'semantic query' }, { embeddingModel: 'p:embed' });
  const first = await find();
  assert.equal(first.indexIncomplete, true); assert.equal(first.records.length, 0);
  const second = await find();
  assert.equal(second.indexIncomplete, undefined); assert.equal(second.records[0].id, 'work:65');
  const previous = batches.length;
  assert.equal((await find()).records[0].id, 'work:65');
  assert.equal(batches.length - previous, 1); // Only the new query needs an embedding.
  records[65].revision = 'v2';
  await find();
  assert.equal(batches.length - previous, 3); // One query plus the changed document.
});

test('foreground searches never build missing vectors; idle indexing finishes and resumes by revision', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-idle-index-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'p',
    baseUrl: 'https://fixture.invalid/v1', models: ['embed'] }] }));
  const batches: string[][] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { input } = JSON.parse(String(init?.body)) as { input: string[] }; batches.push(input);
    return Response.json({ data: input.map((_text, index) => ({ index, embedding: [1, 0] })) });
  });
  const records = Array.from({ length: 135 }, (_, index) => ({ id: `memory:${index}`, agentId: 'a', kind: 'memory' as const,
    title: `item ${index}`, summary: 'independent material', revision: 'v1', timestamp: '2026-11-01T00:00:00Z' }));
  const sources: RecallSources = { sync: async () => {}, list: async () => records, read: async () => null };
  const foreground = () => searchRecall(dataDir, 'a', sources, { query: 'semantic question' },
    { embeddingModel: 'p:embed', indexMode: 'cached' });
  assert.equal((await foreground()).indexIncomplete, true); assert.equal(batches.length, 0);
  await completeRecallIndex(dataDir, 'a', records, 'p:embed', new AbortController().signal);
  assert.equal(batches.flat().length, 135); assert.ok(batches.every(batch => batch.length <= 10));
  const requests = batches.length;
  assert.equal((await foreground()).indexIncomplete, undefined); assert.equal(batches.length, requests + 1);
  await completeRecallIndex(dataDir, 'a', records, 'p:embed', new AbortController().signal);
  assert.equal(batches.length, requests + 1);
  records[100].revision = 'v2';
  await completeRecallIndex(dataDir, 'a', records, 'p:embed', new AbortController().signal);
  assert.deepEqual(batches.at(-1), ['item 100\nindependent material']);
});

test('a work index reservation recovers a missing document without renumbering and preserves corrupt indexes', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-repair-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const source = { id: 'marker', sessionId: 's', sessionTitle: 'work', timestamp: '2026-10-31T00:00:00Z', summary: '原始交接' };
  const record = await registerCompactWork(dataDir, 'a', source);
  const root = path.join(dataDir, 'agents', 'a', 'recall');
  const document = path.join(root, 'work', `${recallHash(record.id)}.json`);
  await fs.rm(document);
  assert.equal((await registerCompactWork(dataDir, 'a', source)).sequence, record.sequence);
  assert.equal(JSON.parse(await fs.readFile(document, 'utf8')).content, source.summary);
  assert.equal((await listWorkRecords(dataDir, 'a')).length, 1);
  await fs.writeFile(path.join(root, 'work-index.json'), '{broken');
  await assert.rejects(registerCompactWork(dataDir, 'a', source), /CORRUPT/);
  assert.equal(await fs.readFile(path.join(root, 'work-index.json'), 'utf8'), '{broken');
});
