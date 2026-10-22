import assert from 'node:assert/strict';
import test from 'node:test';
import { readBackendConnection, signInBackend } from './connection';

test('old or incompatible backend fails the handshake before provider requests', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => Response.json({ error: 'Not Found' }, { status: 404 });
  await assert.rejects(readBackendConnection(), /更新后端/);
  globalThis.fetch = async () => Response.json({ protocolVersion: 2 });
  await assert.rejects(readBackendConnection(), /不兼容/);
});

test('access token is posted once, never included in a URL or stored by the connection client', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const handshake = { protocolVersion: 1, authentication: { required: true, authenticated: true },
    identity: { id: 'remote-human' }, capabilities: { providerRuntime: 'backend', serverPlatform: 'linux',
      desktopBrowser: false, localFilePaths: false } };
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), '/api/connection/session');
    assert.equal(init?.credentials, 'include');
    assert.deepEqual(JSON.parse(String(init?.body)), { token: 'test-access-token' });
    return Response.json(handshake);
  };
  assert.deepEqual(await signInBackend('test-access-token'), handshake);
  assert.equal(calls, 1);
});
