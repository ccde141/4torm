import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listToolCatalog, replaceCustomTools } from './custom-registry.js';
import { FRAMEWORK_TOOLS } from './framework/catalog.js';

async function tempData(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-custom-tools-'));
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('框架工具固定只读，自定义工具单独持久化', async t => {
  const dataDir = await tempData(t);
  const custom = {
    name: 'demo_tool', description: 'demo', executorType: 'custom' as const,
    executorFile: 'demo_tool', parameters: { type: 'object' },
  };
  await replaceCustomTools(dataDir, [custom]);
  const catalog = await listToolCatalog(dataDir);

  assert.deepEqual(catalog.slice(0, FRAMEWORK_TOOLS.length).map(tool => tool.source),
    FRAMEWORK_TOOLS.map(() => 'framework'));
  assert.equal(catalog.find(tool => tool.name === 'read_file')?.readonly, true);
  assert.equal(catalog.find(tool => tool.name === 'demo_tool')?.readonly, false);
  assert.equal(catalog.find(tool => tool.name === 'demo_tool')?.executionMode, 'sync');
});

test('自定义工具只接受同步或可后台化两种执行模式', async t => {
  const dataDir = await tempData(t);
  const base = {
    name: 'background_tool', description: 'background', executorType: 'custom' as const,
    executorFile: 'background_tool', parameters: { type: 'object' },
  };
  const saved = await replaceCustomTools(dataDir, [{ ...base, executionMode: 'detachable' }]);
  assert.equal(saved[0].executionMode, 'detachable');
  await assert.rejects(() => replaceCustomTools(dataDir, [{ ...base, executionMode: 'automatic' }]), /执行模式无效/);
});

test('用户数据不能覆盖框架工具', async t => {
  const dataDir = await tempData(t);
  await assert.rejects(() => replaceCustomTools(dataDir, [{
    name: 'read_file', description: 'shadow', executorType: 'custom',
    executorFile: 'shadow', parameters: { type: 'object' },
  }]), /框架工具不可覆盖/);
});
