import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgent } from './agent';

test('创建 Agent 只调用后端实体入口，不再由前端拼装数据目录', async t => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://local');
    calls.push({ path: url.pathname, method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url.pathname === '/api/agents' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return Response.json({ ...body, id: 'agent-created', status: 'idle',
        createdAt: 'now', updatedAt: 'now', tasksCompleted: 0 }, { status: 201 });
    }
    return new Response('', { status: 404 });
  };

  try {
    const agent = await createAgent({ name: '测试 Agent', role: '', description: '', model: 'p:m' });
    assert.equal(agent.id, 'agent-created');
    assert.deepEqual(calls.map(call => [call.method, call.path]), [['POST', '/api/agents']]);
    assert.equal(JSON.stringify(calls).includes('/api/storage'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
