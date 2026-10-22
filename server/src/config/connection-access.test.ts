import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createConnectionAccess, readConnectionConfiguration } from './connection-access.js';
import { connectionRoutes } from '../routes/connection.js';
import { humanContext, installHumanIdentityPort } from '../routes/collaboration-context.js';

const token = 'test-only-remote-access-token-000000000000';

async function createApp(now?: () => number) {
  const app = Fastify();
  const access = createConnectionAccess({ configuration: { host: '0.0.0.0', accessToken: token },
    internalToken: 'internal-test-capability', now });
  app.addHook('onRequest', access.guard);
  installHumanIdentityPort(app, access.identity);
  await app.register(connectionRoutes, { prefix: '/api/connection', access });
  app.get('/api/private', async request => ({ actor: humanContext(request).actor }));
  app.post('/api/tools/exec', async () => ({ result: 'tool-ok' }));
  app.get('/skin/private.png', async () => 'private-pixels');
  app.get('/', async () => '<html>sign in</html>');
  return app;
}

test('remote listener requires explicit credentials and an approved public origin', () => {
  assert.deepEqual(readConnectionConfiguration({}), { host: 'localhost', accessToken: undefined });
  assert.throws(() => readConnectionConfiguration({ FOURTORM_HOST: '192.0.2.20', FOURTORM_ACCESS_TOKEN: token,
    FOURTORM_PUBLIC_ORIGIN: 'https://4torm.example' }), /内部工具桥接/);
  assert.throws(() => readConnectionConfiguration({ FOURTORM_HOST: '0.0.0.0' }), /访问口令/);
  assert.throws(() => readConnectionConfiguration({ FOURTORM_HOST: '0.0.0.0', FOURTORM_ACCESS_TOKEN: 'short',
    FOURTORM_PUBLIC_ORIGIN: 'https://4torm.example' }), /32/);
  assert.equal(readConnectionConfiguration({ FOURTORM_HOST: '0.0.0.0', FOURTORM_ACCESS_TOKEN: token,
    FOURTORM_PUBLIC_ORIGIN: 'https://4torm.example' }).accessToken, token);
});

test('remote session protects normal API, SSE requests and private assets with the same cookie', async () => {
  const app = await createApp();
  try {
    const before = await app.inject('/api/connection');
    assert.equal(before.statusCode, 200);
    assert.deepEqual(before.json().authentication, { required: true, authenticated: false });
    assert.equal(before.json().capabilities.desktopBrowser, false);
    assert.equal(before.json().capabilities.localFilePaths, false);
    assert.equal((await app.inject('/')).statusCode, 200);
    for (const url of ['/api/private', '/skin/private.png']) {
      assert.equal((await app.inject({ url, headers: { accept: 'text/event-stream' } })).statusCode, 401);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/connection/session', payload: { token: 'incorrect' } })).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/connection/session', payload: { token } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    assert.match(String(login.headers['set-cookie']), /HttpOnly; Secure; SameSite=Strict/);
    assert.equal(login.json().authentication.authenticated, true);
    assert.ok(!login.body.includes(token));
    const result = await app.inject({ url: '/api/private', headers: { cookie, accept: 'text/event-stream' } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().actor.id, 'remote-human');
    const logout = await app.inject({ method: 'DELETE', url: '/api/connection/session', headers: { cookie } });
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    assert.equal(logout.json().authentication.authenticated, false);
    assert.equal((await app.inject('/api/private')).statusCode, 401);
  } finally { await app.close(); }
});

test('tampered or expired sessions fail and the process capability only authorizes a loopback tool bridge', async () => {
  let time = Date.now();
  const app = await createApp(() => time);
  try {
    const login = await app.inject({ method: 'POST', url: '/api/connection/session', payload: { token } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;
    assert.equal((await app.inject({ url: '/api/private', headers: { cookie: tampered } })).statusCode, 401);
    time += 13 * 60 * 60 * 1000;
    assert.equal((await app.inject({ url: '/api/private', headers: { cookie } })).statusCode, 401);
    const headers = { 'x-4torm-internal-token': 'internal-test-capability' };
    assert.equal((await app.inject({ method: 'POST', url: '/api/tools/exec', headers, remoteAddress: '127.0.0.1' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/tools/exec', headers, remoteAddress: '192.0.2.10' })).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/private', headers, remoteAddress: '127.0.0.1' })).statusCode, 401);
  } finally { await app.close(); }
});

test('local desktop keeps its local identity without needing a remote access cookie', async () => {
  const app = Fastify();
  const access = createConnectionAccess({ configuration: { host: 'localhost' }, internalToken: 'local-only' });
  app.addHook('onRequest', access.guard);
  installHumanIdentityPort(app, access.identity);
  app.get('/api/private', async request => humanContext(request));
  try { assert.equal((await app.inject('/api/private')).json().actor.id, 'local-human'); }
  finally { await app.close(); }
});
