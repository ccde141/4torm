import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAgent } from './agent-loader.js';

async function createAgentData(config: Record<string, unknown>): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-agent-loader-'));
  await fs.mkdir(path.join(dataDir, 'agents', 'agent-a', '.workspace'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-a': { id: 'agent-a', name: 'A', model: 'provider:model', config },
  }));
  return dataDir;
}

test('旧 Agent 的空工具配置兼容为全部内置工具模式', async () => {
  const dataDir = await createAgentData({ tools: [] });
  const agent = await loadAgent(dataDir, 'agent-a');
  assert.equal(agent?.toolMode, 'all');
});

test('显式工具模式允许保存空工具清单', async () => {
  const dataDir = await createAgentData({ tools: [], toolMode: 'selected' });
  const agent = await loadAgent(dataDir, 'agent-a');
  assert.equal(agent?.toolMode, 'selected');
  assert.deepEqual(agent?.tools, []);
});

test('旧权限值加载为项目级，新无限制值保持不变', async () => {
  const legacyDir = await createAgentData({ sandboxLevel: 'strict' });
  const legacyAgent = await loadAgent(legacyDir, 'agent-a');
  assert.equal(legacyAgent?.sandboxLevel, 'project');

  const unrestrictedDir = await createAgentData({ sandboxLevel: 'unrestricted' });
  const unrestrictedAgent = await loadAgent(unrestrictedDir, 'agent-a');
  assert.equal(unrestrictedAgent?.sandboxLevel, 'unrestricted');
});
