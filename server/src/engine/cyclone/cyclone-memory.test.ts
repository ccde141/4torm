import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCycloneMemoryPrompt,
  executeCycloneMemoryTool,
  withCycloneMemoryTools,
} from './cyclone-memory.js';

test('气旋工位使用绑定 Agent 的长期记忆工具与召回', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-memory-'));
  try {
    const tools = withCycloneMemoryTools([]);
    assert.deepEqual(tools.map(tool => tool.name), [
      'memory_write', 'memory_list', 'memory_read',
    ]);

    const written = await executeCycloneMemoryTool(dataDir, 'agent-a', 'memory_write', {
      summary: '气旋测试偏好', detail: '用户偏好短句结论。', category: 'feedback', tags: '气旋,测试',
    });
    assert.match(written!, /已记入长期记忆/);
    assert.match(await executeCycloneMemoryTool(dataDir, 'agent-a', 'memory_list', {}) ?? '', /气旋测试偏好/);

    const prompt = await buildCycloneMemoryPrompt(dataDir, 'agent-a', '气旋测试偏好');
    assert.match(prompt, /你的经验记忆/);
    assert.match(prompt, /memory_write/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('非记忆工具不被气旋记忆执行器截获', async () => {
  assert.equal(await executeCycloneMemoryTool('unused', 'agent-a', 'read_file', {}), null);
});
