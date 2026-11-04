import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execMemoryTool } from './agent-memory.js';

test('large memory lists are bounded, filterable and traversable without dumping the whole index', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-pages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'agents', 'a', 'memory'); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'index.md'), '# Synthetic index\n' + Array.from({ length: 10000 }, (_, i) =>
    `- item-${i} | fact | ${i % 2 ? '青禾' : '赤砂'} | 示例约定${i}`).join('\n'));
  const list = (args: Record<string, string>) => execMemoryTool(root, 'a', 'test', 'memory_list', args);
  const first = await list({});
  assert.match(first, /共 10000 条/); assert.match(first, /offset=50/);
  assert.equal(first.split('\n').filter(line => line.startsWith('- ')).length, 50);
  assert.ok(first.length < 8000); assert.doesNotMatch(first, /item-9999/);
  const next = await list({ offset: '50', limit: '50' });
  assert.match(next, /item-50 /); assert.doesNotMatch(next, /item-49 /);
  const filtered = await list({ query: '青禾', limit: '2' });
  assert.match(filtered, /共 5000 条/); assert.doesNotMatch(filtered, /#赤砂/);
  assert.match(await list({ limit: '101' }), /参数无效/);
  assert.match(await list({ offset: '-1' }), /参数无效/);
});
