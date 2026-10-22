import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeMemory, updateMemory, deleteMemory, listMemory, readMemory } from './agent-memory.js';
import { agentMemoryDir } from '../../services/data-paths.js';

const agentId = 'agent';
const now = '2026-10-21T00:00:00.000Z';
const memory = (summary: string, detail = summary) => ({ summary, detail,
  category: 'fact' as const, source: 'test', now });

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-memory-concurrency-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const write = (summary: string, detail?: string) => writeMemory(dataDir, agentId, memory(summary, detail));
  return { dataDir, write, directory: agentMemoryDir(dataDir, agentId) };
}

test('池化 Agent 同时写不同记忆不会丢失索引行', async t => {
  const f = await fixture(t);
  const writes = await Promise.all(Array.from({ length: 12 }, (_, n) => f.write(`fact ${n}`, `detail ${n}`)));
  const rows = await listMemory(f.dataDir, agentId);
  assert.equal(rows.length, writes.length);
  for (let n = 0; n < writes.length; n++) {
    assert.equal((await readMemory(f.dataDir, agentId, writes[n].slug))?.detail, `detail ${n}`);
  }
});

test('池化 Agent 同时写同摘要时为每条正文分配独立 slug', async t => {
  const f = await fixture(t);
  const writes = await Promise.all(Array.from({ length: 8 }, (_, n) => f.write('same title', `detail ${n}`)));
  assert.equal(new Set(writes.map(result => result.slug)).size, 8);
  assert.equal((await listMemory(f.dataDir, agentId)).length, 8);
  for (let n = 0; n < writes.length; n++) {
    assert.equal((await readMemory(f.dataDir, agentId, writes[n].slug))?.detail, `detail ${n}`);
  }
});

test('同一 Agent 的编辑、删除与新增共享完整的变更锁', async t => {
  const f = await fixture(t);
  const first = await f.write('first');
  const removed = await f.write('removed');
  await Promise.all([
    updateMemory(f.dataDir, agentId, first.slug, { detail: 'changed', now }),
    updateMemory(f.dataDir, agentId, first.slug, { category: 'feedback', now }),
    deleteMemory(f.dataDir, agentId, removed.slug),
    f.write('created'),
  ]);
  const rows = await listMemory(f.dataDir, agentId);
  assert.deepEqual(rows.map(row => row.slug).sort(), ['created', first.slug].sort());
  const entry = await readMemory(f.dataDir, agentId, first.slug);
  assert.equal(entry?.detail, 'changed');
  assert.equal(entry?.category, 'feedback');
  assert.equal(await readMemory(f.dataDir, agentId, removed.slug), null);
});

for (const indexContents of ['damaged index', '', '- entry | unknown | | summary']) {
  test(`损坏的记忆索引阻止所有变更并保留原文: ${JSON.stringify(indexContents)}`, async t => {
    const f = await fixture(t);
    const original = await f.write('original');
    const entryFile = path.join(f.directory, `${original.slug}.md`);
    const originalEntry = await fs.readFile(entryFile, 'utf8');
    const indexFile = path.join(f.directory, 'index.md');
    await fs.writeFile(indexFile, indexContents);
    await assert.rejects(listMemory(f.dataDir, agentId), /长期记忆数据损坏/);
    await assert.rejects(f.write('new'), /长期记忆数据损坏/);
    await assert.rejects(updateMemory(f.dataDir, agentId, original.slug, { detail: 'must not overwrite', now }),
      /长期记忆数据损坏/);
    await assert.rejects(deleteMemory(f.dataDir, agentId, original.slug), /长期记忆数据损坏/);
    assert.equal(await fs.readFile(indexFile, 'utf8'), indexContents);
    assert.equal(await fs.readFile(entryFile, 'utf8'), originalEntry);
  });
}

test('索引 IO 失败在修改主文件之前报告，失败队列不阻塞后续合法变更', async t => {
  const f = await fixture(t);
  const original = await f.write('original');
  const entryFile = path.join(f.directory, `${original.slug}.md`);
  const originalEntry = await fs.readFile(entryFile, 'utf8');
  const indexFile = path.join(f.directory, 'index.md');
  await fs.rename(indexFile, `${indexFile}.backup`);
  await fs.mkdir(indexFile);
  await assert.rejects(updateMemory(f.dataDir, agentId, original.slug, { detail: 'must not overwrite', now }));
  await assert.rejects(deleteMemory(f.dataDir, agentId, original.slug));
  await assert.rejects(f.write('new'));
  assert.equal(await fs.readFile(entryFile, 'utf8'), originalEntry);
  await fs.rmdir(indexFile);
  await fs.rename(`${indexFile}.backup`, indexFile);
  await f.write('next');
  assert.equal((await listMemory(f.dataDir, agentId)).length, 2);
});

test('索引缺失时不复用磁盘已有条目的 slug，也不能越界读取', async t => {
  const f = await fixture(t);
  const first = await f.write('same', 'first detail');
  await fs.rm(path.join(f.directory, 'index.md'));
  const second = await f.write('same', 'second detail');
  assert.notEqual(first.slug, second.slug);
  assert.equal((await readMemory(f.dataDir, agentId, first.slug))?.detail, 'first detail');
  assert.equal((await readMemory(f.dataDir, agentId, second.slug))?.detail, 'second detail');
  await assert.rejects(readMemory(f.dataDir, agentId, '../../outside'), /slug 无效/);
});

test('损坏的记忆条目与不存在的条目明确区分，编辑不会覆盖损坏原文', async t => {
  const f = await fixture(t);
  const original = await f.write('original');
  const file = path.join(f.directory, `${original.slug}.md`);
  await fs.writeFile(file, 'broken entry');
  await assert.rejects(readMemory(f.dataDir, agentId, original.slug), /长期记忆数据损坏/);
  await assert.rejects(updateMemory(f.dataDir, agentId, original.slug, { detail: 'new', now }), /长期记忆数据损坏/);
  assert.equal(await fs.readFile(file, 'utf8'), 'broken entry');
  assert.equal(await readMemory(f.dataDir, agentId, 'missing'), null);
});

test('空库起始就保留 index 控制文件名，同名摘要和后缀碰撞不覆盖任何正文', async t => {
  const f = await fixture(t);
  const first = await f.write('index', 'first');
  const second = await f.write('index-2', 'second');
  const third = await f.write('index', 'third');
  assert.equal(first.slug, 'index-2');
  assert.equal(second.slug, 'index-2-2');
  assert.equal(third.slug, 'index-3');
  assert.equal((await listMemory(f.dataDir, agentId)).length, 3);
  assert.equal((await readMemory(f.dataDir, agentId, first.slug))?.detail, 'first');
  assert.equal((await readMemory(f.dataDir, agentId, second.slug))?.detail, 'second');
  assert.equal((await readMemory(f.dataDir, agentId, third.slug))?.detail, 'third');
  const index = await fs.readFile(path.join(f.directory, 'index.md'), 'utf8');
  for (const slug of ['index', 'INDEX']) {
    await assert.rejects(readMemory(f.dataDir, agentId, slug), /slug 无效/);
    await assert.rejects(updateMemory(f.dataDir, agentId, slug, { detail: 'bad', now }), /slug 无效/);
    await assert.rejects(deleteMemory(f.dataDir, agentId, slug), /slug 无效/);
  }
  assert.equal(await fs.readFile(path.join(f.directory, 'index.md'), 'utf8'), index);
});
