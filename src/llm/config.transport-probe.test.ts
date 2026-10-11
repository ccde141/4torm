import assert from 'node:assert/strict';
import test from 'node:test';
import { invalidateCache, probeAndStore, probeVisionAndStore } from './config.js';

test('explicit Anthropic transport drives probe and stores the server fingerprint', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; invalidateCache(); });
  const provider = {
    id: 'pvd_proxy', label: 'Proxy', baseUrl: 'https://claude.proxy.test/v1',
    apiKey: 'secret', models: ['demo'], providerType: 'anthropic',
    transport: 'anthropic-messages', protocol: 'openai-chat-completions',
  };
  const fingerprint = JSON.stringify([
    provider.id, provider.baseUrl, provider.transport, provider.providerType,
    'demo', 'auto', 2,
  ]);
  let saved: unknown;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith('/api/storage/read')) {
      return new Response(JSON.stringify({ providers: [provider], activeModel: '' }));
    }
    if (url.startsWith('/api/model-runtime/tool-transport?')) {
      return new Response(JSON.stringify({
        protocol: 'anthropic-messages', fingerprint,
        baseUrl: provider.baseUrl, profile: 'auto',
      }));
    }
    if (url === 'https://claude.proxy.test/v1/messages') {
      assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'secret');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.tools[0].name, 'ping');
      return new Response(JSON.stringify({ error: { message: 'Tools are not supported' } }), {
        status: 400,
      });
    }
    if (url.startsWith('/api/storage/write')) {
      saved = JSON.parse(String(init?.body));
      return new Response('{}');
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  invalidateCache();

  const result = await probeAndStore(provider.id, 'demo');

  assert.equal(result.status, 'text-required');
  assert.equal(requests.includes('https://claude.proxy.test/v1/chat/completions'), false);
  assert.equal((saved as { providers: Array<{ toolTransports: Record<string, { fingerprint: string }> }> })
    .providers[0].toolTransports.demo.fingerprint, fingerprint);
});

test('explicit Anthropic transport also drives the vision probe', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; invalidateCache(); });
  const provider = {
    id: 'pvd_vision', label: 'Vision proxy', baseUrl: 'https://vision.proxy.test/v1',
    apiKey: 'secret', models: ['demo'], providerType: 'anthropic',
    transport: 'anthropic-messages', protocol: 'openai-chat-completions',
  };
  let saved: unknown;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/storage/read')) {
      return new Response(JSON.stringify({ providers: [provider], activeModel: '' }));
    }
    if (url.startsWith('/api/model-runtime/tool-transport?')) {
      return new Response(JSON.stringify({ protocol: 'anthropic-messages', fingerprint: 'unused' }));
    }
    if (url === 'https://vision.proxy.test/v1/messages') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[0].content[1].type, 'image');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }));
    }
    if (url.startsWith('/api/storage/write')) {
      saved = JSON.parse(String(init?.body));
      return new Response('{}');
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  invalidateCache();

  assert.deepEqual(await probeVisionAndStore(provider.id, 'demo'), { status: 'supported' });
  assert.equal((saved as { providers: Array<{ modelCapabilities: Record<string, { vision: { status: string } }> }> })
    .providers[0].modelCapabilities.demo.vision.status, 'supported');
});
