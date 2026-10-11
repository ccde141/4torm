import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:http2';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import test from 'node:test';
import { initSSE } from '../utils/sse.js';
import { loadTransportCredentials } from './transport.js';

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
