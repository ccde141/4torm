import assert from 'node:assert/strict';
import test from 'node:test';
import { abortCycloneExecution } from './cyclone-execution-client.js';

test('气旋中止把完整执行身份提交给中心路由', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; body?: string } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), body: String(init?.body) };
    return new Response(JSON.stringify({ stopped: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await abortCycloneExecution('seat:workshop-1:seat-1', 'cyclone-run-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request?.url, '/api/collaboration/invoke');
  assert.deepEqual(JSON.parse(request?.body || '{}'), {
    feature: 'cyclone', method: 'abortExecution',
    input: { operationId: 'seat:workshop-1:seat-1', runId: 'cyclone-run-1' },
  });
});
