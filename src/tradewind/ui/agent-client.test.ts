import assert from 'node:assert/strict';
import test from 'node:test';
import { listTradewindAgents } from './agent-client';

test('agent choices are read through the collaboration center', async t => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify([{ id: 'agent-a', name: '规划者', model: 'deepseek' }]));
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal((await listTradewindAgents())[0]?.id, 'agent-a');
  assert.deepEqual(body, {
    feature: 'tradewind', method: 'listAgentSummaries', input: {},
  });
});
