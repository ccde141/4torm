import assert from 'node:assert/strict';
import test from 'node:test';
import { MissingIndexReadCache } from './session-index-cache';

test('缺失索引的并发读取合并并缓存空结果', async () => {
  const cache = new MissingIndexReadCache<string[]>();
  let reads = 0;
  const loader = async () => { reads++; return null; };

  const [first, second] = await Promise.all([
    cache.read('agent-a', loader),
    cache.read('agent-a', loader),
  ]);
  const cached = await cache.read('agent-a', loader);

  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(cached, null);
  assert.equal(reads, 1);
});

test('会话写入后失效空索引缓存', async () => {
  const cache = new MissingIndexReadCache<string[]>();
  let reads = 0;
  const loader = async () => { reads++; return reads === 1 ? null : ['session-a']; };

  await cache.read('agent-a', loader);
  cache.invalidate('agent-a');

  assert.deepEqual(await cache.read('agent-a', loader), ['session-a']);
  assert.equal(reads, 2);
});

test('读取途中发生写入时不缓存过期的空结果', async () => {
  const cache = new MissingIndexReadCache<string[]>();
  let finishRead!: (value: string[] | null) => void;
  const pending = cache.read('agent-a', () => new Promise(resolve => { finishRead = resolve; }));

  cache.invalidate('agent-a');
  finishRead(null);
  await pending;

  assert.deepEqual(await cache.read('agent-a', async () => ['session-a']), ['session-a']);
});
