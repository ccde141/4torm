import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionsByAgent } from './chat.js';

test('季风读取混合索引时去重并忽略空壳条目', async (t) => {
  const originalFetch = globalThis.fetch;
  const agentId = 'agent-mixedindex';
  const sessionId = `${agentId}-session-a`;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://local');
    const filePath = url.searchParams.get('path');
    if (filePath === `agents/${agentId}/sessions/_index.json`) {
      return new Response(JSON.stringify([
        { i: sessionId, t: '潮汐测试', u: '2026-07-19T14:07:56.068Z', n: 'Agent A' },
        sessionId,
      ]));
    }
    return new Response('', { status: 404 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const sessions = await getSessionsByAgent(agentId);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].title, '潮汐测试');
});
