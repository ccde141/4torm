import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionsByAgent } from './chat.js';

test('季风前端只消费服务端归一化后的会话列表', async (t) => {
  const originalFetch = globalThis.fetch;
  const agentId = 'agent-mixedindex';
  const sessionId = `${agentId}-session-a`;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://local');
    if (url.pathname === `/api/conversation/sessions/${agentId}`) {
      return Response.json([{
        id: sessionId, agentId, agentName: 'Agent A', title: '潮汐测试',
        updatedAt: '2026-07-19T14:07:56.068Z', createdAt: '2026-07-19T14:07:56.068Z',
        messages: [], model: '', systemPrompt: '', revision: 4,
      }]);
    }
    return new Response('', { status: 404 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const sessions = await getSessionsByAgent(agentId);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].title, '潮汐测试');
  assert.equal(sessions[0].revision, 4);
});
