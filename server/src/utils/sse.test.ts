import assert from 'node:assert/strict';
import test from 'node:test';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { FrameworkError } from '../engine/shared/framework-error.js';
import { enforceBrowserOrigin, initSSE, isAllowedBrowserOrigin, browserCorsOrigin,
  pushSSE, pushSSEError, sseResponseHeaders } from './sse.js';

test('HTTP/2 SSE headers omit the forbidden Connection field', () => {
  let headers: Record<string, string> = {};
  const reply = {
    request: { headers: {}, raw: { httpVersionMajor: 2 } },
    raw: { writeHead: (_status: number, value: Record<string, string>) => { headers = value; } },
  } as never;
  initSSE(reply);
  assert.equal(headers.Connection, undefined);
  assert.equal(headers['Content-Type'], 'text/event-stream');
});

test('SSE CORS accepts only the local UI origins and keeps origin-less streams usable', () => {
  const desktopPort = Number.parseInt(process.env.PORT || '3001', 10);
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173',
    `https://localhost:${desktopPort}`, `https://127.0.0.1:${desktopPort}`]) {
    const headers = sseResponseHeaders(2, origin);
    assert.equal(headers['Access-Control-Allow-Origin'], origin);
    assert.equal(headers['Access-Control-Allow-Credentials'], 'true');
  }
  for (const origin of ['https://remote.example', 'http://localhost:9999',
    'http://localhost.evil.example:5173', 'null']) {
    assert.equal(sseResponseHeaders(2, origin)['Access-Control-Allow-Origin'], undefined);
  }
  assert.equal(sseResponseHeaders(2)['Access-Control-Allow-Origin'], undefined);
});

test('a configured desktop renderer may use another loopback port, never a remote origin', t => {
  const previous = process.env.ELECTRON_RENDERER_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.ELECTRON_RENDERER_URL;
    else process.env.ELECTRON_RENDERER_URL = previous;
  });
  process.env.ELECTRON_RENDERER_URL = 'http://localhost:5174/view';
  assert.equal(isAllowedBrowserOrigin('http://localhost:5174'), true);
  process.env.ELECTRON_RENDERER_URL = 'https://remote.example/view';
  assert.equal(isAllowedBrowserOrigin('https://remote.example'), false);
});

test('ordinary HTTP CORS rejects foreign origins without blocking local or origin-less requests', async t => {
  const app = Fastify();
  app.addHook('onRequest', enforceBrowserOrigin);
  await app.register(cors, { origin: browserCorsOrigin });
  app.get('/health', async () => ({ ok: true }));
  let writes = 0;
  app.post('/write', async () => ({ writes: ++writes }));
  t.after(() => app.close());
  for (const origin of ['http://localhost:5173', 'https://localhost:' + (process.env.PORT || '3001')]) {
    const response = await app.inject({ method: 'OPTIONS', url: '/health', headers: {
      origin, 'access-control-request-method': 'GET',
    } });
    assert.equal(response.headers['access-control-allow-origin'], origin);
  }
  for (const origin of ['https://remote.example', 'http://localhost.evil.example:5173']) {
    const response = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  const blockedWrite = await app.inject({ method: 'POST', url: '/write', headers: {
    origin: 'https://remote.example', 'content-type': 'text/plain',
  }, payload: 'blind write' });
  assert.equal(blockedWrite.statusCode, 403);
  assert.equal(writes, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/write', headers: {
    origin: 'http://localhost:5173',
  } })).statusCode, 200);
  assert.equal((await app.inject('/health')).statusCode, 200);
});

test('one explicit public HTTPS origin is shared by HTTP, CORS and SSE', async t => {
  const previous = process.env.FOURTORM_PUBLIC_ORIGIN;
  const origin = 'https://4torm.home.arpa:8443';
  process.env.FOURTORM_PUBLIC_ORIGIN = origin;
  const app = Fastify();
  t.after(async () => {
    if (previous === undefined) delete process.env.FOURTORM_PUBLIC_ORIGIN;
    else process.env.FOURTORM_PUBLIC_ORIGIN = previous;
    await app.close();
  });
  app.addHook('onRequest', enforceBrowserOrigin);
  await app.register(cors, { origin: browserCorsOrigin });
  let writes = 0;
  app.post('/write', async () => ({ writes: ++writes }));
  const preflight = await app.inject({ method: 'OPTIONS', url: '/write', headers: {
    origin, 'access-control-request-method': 'POST',
  } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);
  const allowed = await app.inject({ method: 'POST', url: '/write', headers: { origin } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(writes, 1);
  const sse = sseResponseHeaders(2, origin);
  assert.equal(sse['Access-Control-Allow-Origin'], origin);
  assert.equal(sse['Access-Control-Allow-Credentials'], 'true');
  assert.equal(sse.Connection, undefined);
  for (const foreign of ['http://4torm.home.arpa:8443', 'https://4torm.home.arpa:8444',
    'https://4torm.home.arpa.evil.example:8443', `${origin}/path`, 'null']) {
    const response = await app.inject({ method: 'POST', url: '/write', headers: { origin: foreign } });
    assert.equal(response.statusCode, 403);
    assert.equal(sseResponseHeaders(2, foreign)['Access-Control-Allow-Origin'], undefined);
  }
  assert.equal(writes, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/write' })).statusCode, 200);
});

test('invalid public-origin configuration fails explicitly instead of widening the boundary', t => {
  const previous = process.env.FOURTORM_PUBLIC_ORIGIN;
  t.after(() => {
    if (previous === undefined) delete process.env.FOURTORM_PUBLIC_ORIGIN;
    else process.env.FOURTORM_PUBLIC_ORIGIN = previous;
  });
  for (const invalid of ['', '*', 'null', 'http://4torm.home.arpa:8443',
    'https://*.home.arpa:8443', 'https://owner:secret@4torm.home.arpa:8443',
    'https://@4torm.home.arpa:8443', 'https://4torm.home.arpa:8443/',
    'https://4torm.home.arpa:8443/path', 'https://4torm.home.arpa:8443?query=1',
    'https://4torm.home.arpa:8443#fragment', 'https:4torm.home.arpa:8443',
    'https://4torm.home.arpa:8443\\path', ' https://4torm.home.arpa:8443 ']) {
    process.env.FOURTORM_PUBLIC_ORIGIN = invalid;
    assert.throws(() => isAllowedBrowserOrigin('https://4torm.home.arpa:8443'),
      /FOURTORM_PUBLIC_ORIGIN/);
  }
});

test('pushSSE 按调用顺序写入完整 JSON data 帧', () => {
  const chunks: string[] = [];
  const reply = { raw: { write: (chunk: string) => { chunks.push(chunk); } } } as never;

  pushSSE(reply, { type: 'token', content: 'a' });
  pushSSE(reply, { type: 'tool-call', tool: 'read_file', args: { filePath: 'a.txt' } });
  pushSSE(reply, { type: 'done' });

  assert.deepEqual(chunks.map(chunk => JSON.parse(chunk.slice(6, -2))), [
    { type: 'token', content: 'a' },
    { type: 'tool-call', tool: 'read_file', args: { filePath: 'a.txt' } },
    { type: 'done' },
  ]);
});

test('pushSSEError 保留兼容事件并附加稳定错误字段', () => {
  const chunks: string[] = [];
  const reply = { raw: { write: (chunk: string) => { chunks.push(chunk); } } } as never;
  const error = new FrameworkError({
    code: 'MODEL_HTTP_ERROR', kind: 'provider', message: '模型服务不可用',
    source: 'conversation.model', retryable: true,
  });

  pushSSEError(reply, error, 'sse.conversation');

  assert.deepEqual(JSON.parse(chunks[0].slice(6, -2)), {
    type: 'error', message: '模型服务不可用', code: 'MODEL_HTTP_ERROR', kind: 'provider',
  });
});

test('pushSSEError 不发送未知异常中的内部路径', () => {
  const chunks: string[] = [];
  const reply = { raw: { write: (chunk: string) => { chunks.push(chunk); } } } as never;

  pushSSEError(reply, new Error('C:\\private\\secret.txt'), 'sse.room');

  assert.deepEqual(JSON.parse(chunks[0].slice(6, -2)), {
    type: 'error', message: '服务器内部错误', code: 'INTERNAL_ERROR', kind: 'internal',
  });
});
