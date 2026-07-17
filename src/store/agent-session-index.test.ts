import assert from 'node:assert/strict';
import test from 'node:test';
import { invalidateCache } from '../llm/config';
import { createAgent } from './agent';

test('创建 Agent 时初始化空会话索引', async () => {
  const originalFetch = globalThis.fetch;
  const writes: string[] = [];
  invalidateCache();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://local');
    const filePath = url.searchParams.get('path') || '';
    if (url.pathname.endsWith('/read') && filePath === 'providers.json') {
      return new Response('', { status: 404 });
    }
    if (url.pathname.endsWith('/read') && filePath === 'agents/registry.json') {
      return new Response('{}', { status: 200 });
    }
    if (init?.method === 'PUT') writes.push(filePath);
    return new Response('{}', { status: 200 });
  };

  try {
    const agent = await createAgent({ name: '测试 Agent', role: '', description: '' });
    assert.ok(writes.includes(`agents/${agent.id}/sessions/_index.json`));
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCache();
  }
});
