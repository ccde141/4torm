import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:http2';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import test from 'node:test';
import { performGracefulShutdown } from '../services/graceful-shutdown.js';
import { initSSE, startHeartbeat } from '../utils/sse.js';
import { loadTransportCredentials } from './transport.js';
import { installTransportShutdown } from './transport-shutdown.js';

test('eight concurrent SSE streams use one authenticated HTTP/2 session', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-h2-sse-'));
  const tls = await loadTransportCredentials(dir, {});
  const app = Fastify({ http2: true, https: { key: tls.key, cert: tls.cert, allowHTTP1: true } });
  app.get('/events', (req, reply) => {
    reply.hijack();
    initSSE(reply);
    reply.raw.write('data: {"type":"done"}\n\n');
    reply.raw.end();
  });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = connect(address, { ca: tls.cert });
    try {
      const responses = await Promise.all(Array.from({ length: 8 }, () => new Promise<string>((resolve, reject) => {
        const stream = client.request({ ':path': '/events' });
        let body = '';
        stream.setEncoding('utf8');
        stream.on('data', chunk => { body += chunk; });
        stream.on('end', () => resolve(body));
        stream.on('error', reject);
        stream.end();
      })));
      assert.equal(client.alpnProtocol, 'h2');
      assert.equal(responses.length, 8);
      assert.ok(responses.every(body => body.includes('"type":"done"')));
    } finally { client.close(); }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const protocol of ['h2', 'http1'] as const) {
  test(`shutdown drains writes before closing a persistent ${protocol} observation stream`, async t => {
    const order: string[] = [];
    const fixture = await persistentObservation(protocol, order);
    t.after(fixture.dispose);
    await performGracefulShutdown({
      stopScheduler: () => { order.push('scheduler'); },
      stopMonsoon: async () => {},
      stopTradewind: async () => {}, drainTide: async () => {}, drainCyclone: async () => {},
      drainConvection: async () => {}, stopBackgroundExecutions: async () => {},
      drainWrites: async () => { order.push('writes'); },
      shutdownMcp: () => { order.push('mcp'); },
      closeServer: () => { order.push('server'); return fixture.app.close(); },
    }, 500);
    await fixture.released;
    assert.deepEqual(order, ['scheduler', 'writes', 'mcp', 'server', 'released']);
    assert.equal(fixture.app.server.listening, false);
  });
}

async function persistentObservation(protocol: 'h2' | 'http1', order: string[]) {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-sse-shutdown-'));
  const tls = await loadTransportCredentials(dir, {});
  const app = Fastify({ http2: true, https: { key: tls.key, cert: tls.cert, allowHTTP1: true } });
  installTransportShutdown(app);
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  app.get('/events', (_req, reply) => {
    reply.hijack();
    initSSE(reply);
    reply.raw.write(': observation\n\n');
    const stop = startHeartbeat(reply);
    reply.raw.once('close', () => { stop(); order.push('released'); release(); });
  });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const disconnect = await openObservation(protocol, address, tls.cert);
    return {
      app, released,
      dispose: async () => {
        disconnect();
        await app.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function openObservation(protocol: 'h2' | 'http1', address: string, cert: string) {
  if (protocol === 'h2') {
    const client = connect(address, { ca: cert });
    const stream = client.request({ ':path': '/events' });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('error', reject);
        stream.once('data', () => resolve());
        stream.once('error', reject);
        stream.end();
      });
    } catch (error) { stream.destroy(); client.destroy(); throw error; }
    return () => { stream.destroy(); client.destroy(); };
  }
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const request = get(`${address}/events`, { ca: cert, headers: { connection: 'keep-alive' } }, res => {
      res.once('error', reject);
      res.once('data', () => resolve(res));
    });
    request.once('error', reject);
  });
  return () => response.destroy();
}
