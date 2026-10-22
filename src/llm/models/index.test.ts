import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels } from './index.js';

test('lists Anthropic models with protocol headers', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ data: [{ id: 'claude-test' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await listModels({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'secret',
      protocol: 'anthropic-messages',
    });

    assert.equal(request?.url, '/api/model-runtime/models');
    assert.equal(request?.body.baseUrl, 'https://api.anthropic.com/v1');
    const upstreamHeaders = new Headers(request?.body.headers as Record<string, string>);
    assert.equal(upstreamHeaders.get('x-api-key'), 'secret');
    assert.equal(upstreamHeaders.get('anthropic-version'), '2023-06-01');
    assert.equal(request?.headers.get('x-api-key'), null);
    assert.equal(request?.headers.get('authorization'), null);
    assert.equal(result.data[0]?.id, 'claude-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not append models twice and preserves custom header overrides', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await listModels({
      baseUrl: 'https://proxy.example/v1/models/',
      apiKey: 'secret',
      protocol: 'anthropic-messages',
      headers: { 'anthropic-version': '2024-01-01' },
    });

    assert.equal(request?.url, '/api/model-runtime/models');
    assert.equal(request?.body.baseUrl, 'https://proxy.example/v1');
    assert.equal(new Headers(request?.body.headers as Record<string, string>).get('anthropic-version'), '2024-01-01');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local model discovery uses the same backend path and keeps provider credentials in its body', async () => {
  const originalFetch = globalThis.fetch;
  const signal = new AbortController().signal;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/model-runtime/models');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'test-key', headers: { 'X-Local': 'enabled' },
    });
    assert.equal(init?.signal?.aborted, false);
    return Response.json({ data: [{ id: 'local-model' }] });
  };
  try {
    const result = await listModels({ baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'test-key',
      headers: { 'X-Local': 'enabled' }, signal });
    assert.equal(result.data[0]?.id, 'local-model');
  } finally { globalThis.fetch = originalFetch; }
});

test('model discovery reports upstream HTTP failures instead of an empty model list', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: '模型列表请求失败（HTTP 404）' }, { status: 404 });
  try {
    await assert.rejects(listModels({ baseUrl: 'http://127.0.0.1:8080/v1' }), /HTTP 404/);
  } finally { globalThis.fetch = originalFetch; }
});
