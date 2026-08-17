import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent, AgentConfig } from '../types';
import { updateAgentConfig } from './agent';

test('保存 Agent 配置与基本信息只写一次 registry', async () => {
  const originalFetch = globalThis.fetch;
  const agent = { id: 'agent-a', name: '旧名称', model: 'old', config: {} } as Agent;
  const registryWrites: Record<string, Agent>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://local');
    const filePath = url.searchParams.get('path');
    if (url.pathname.endsWith('/read') && filePath === 'agents/registry.json') {
      return new Response(JSON.stringify({ 'agent-a': agent }));
    }
    if (init?.method === 'PUT' && filePath === 'agents/registry.json') {
      registryWrites.push(JSON.parse(String(init.body)));
    }
    return new Response('{}');
  };

  try {
    const config = { rolePrompt: '新提示词' } as AgentConfig;
    await updateAgentConfig('agent-a', config, 'new-model', { name: '新名称', role: '新角色' });
    assert.equal(registryWrites.length, 1);
    assert.equal(registryWrites[0]['agent-a'].name, '新名称');
    assert.equal(registryWrites[0]['agent-a'].role, '新角色');
    assert.equal(registryWrites[0]['agent-a'].model, 'new-model');
    assert.deepEqual(registryWrites[0]['agent-a'].config, config);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
