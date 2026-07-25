import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels } from './index.js';

test('lists Anthropic models with protocol headers', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; headers: Headers } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), headers: new Headers(init?.headers) };
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

    assert.equal(request?.url, 'https://api.anthropic.com/v1/models');
    assert.equal(request?.headers.get('x-api-key'), 'secret');
    assert.equal(request?.headers.get('anthropic-version'), '2023-06-01');
    assert.equal(request?.headers.get('authorization'), null);
    assert.equal(result.data[0]?.id, 'claude-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not append models twice and preserves custom header overrides', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; headers: Headers } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), headers: new Headers(init?.headers) };
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

    assert.equal(request?.url, 'https://proxy.example/v1/models');
    assert.equal(request?.headers.get('anthropic-version'), '2024-01-01');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
