import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent, AgentConfig } from '../types';
import { updateAgentConfig } from './agent';

test('保存 Agent 配置与基本信息只调用一次后端实体入口', async () => {
  const originalFetch = globalThis.fetch;
  const agent = { id: 'agent-a', name: '旧名称', model: 'old', config: {} } as Agent;
  const calls: Array<{ path: string; method: string; body?: any }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://local');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname, method: init?.method ?? 'GET', body });
    return Response.json({ ...agent, ...body?.patch, model: body?.model, config: body?.config });
  };

  try {
    const config = { rolePrompt: '新提示词' } as AgentConfig;
    await updateAgentConfig('agent-a', config, 'new-model', {
      name: '新名称', role: '新角色',
    });
    assert.deepEqual(calls, [{ path: '/api/agents/agent-a/config', method: 'PUT',
      body: { config, model: 'new-model', patch: {
        name: '新名称', role: '新角色',
      } } }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
