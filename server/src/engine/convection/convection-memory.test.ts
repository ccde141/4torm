import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listMemory, readMemory } from '../shared/agent-memory.js';
import {
  buildConvectionMemoryPrompt,
  executeConvectionMemoryTool,
  withConvectionMemoryTools,
} from './convection-memory.js';

test('对流参与者使用各自 Agent 的长期记忆且互不串线', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-memory-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await executeConvectionMemoryTool(dataDir, 'agent-a', 'memory_write', {
    summary: 'release-alpha preference', detail: 'A 记得用户偏好灰度发布。', category: 'fact', tags: 'release-alpha',
  });
  await executeConvectionMemoryTool(dataDir, 'agent-b', 'memory_write', {
    summary: 'budget-beta experience', detail: 'B 记得预算必须保留缓冲。', category: 'fact', tags: 'budget-beta',
  });

  const promptA = await buildConvectionMemoryPrompt(dataDir, 'agent-a', 'release-alpha');
  const promptB = await buildConvectionMemoryPrompt(dataDir, 'agent-b', 'budget-beta');
  assert.match(promptA, /灰度发布/);
  assert.doesNotMatch(promptA, /预算必须/);
  assert.match(promptB, /预算必须/);
  assert.doesNotMatch(promptB, /灰度发布/);

  const [row] = await listMemory(dataDir, 'agent-a');
  assert.equal((await readMemory(dataDir, 'agent-a', row.slug))?.source, 'convection');
});

test('对流追加记忆工具但不复制已有同名定义', () => {
  const existing = { name: 'memory_list', description: 'existing' };
  const tools = withConvectionMemoryTools([existing]);
  assert.deepEqual(tools.map(tool => tool.name), ['memory_list', 'memory_write', 'memory_read']);
  assert.equal(tools[0], existing);
});

test('非记忆工具不会被对流记忆执行器截获', async () => {
  assert.equal(await executeConvectionMemoryTool('unused', 'agent-a', 'read_file', {}), null);
});
