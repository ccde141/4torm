import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import test from 'node:test';
import { execToolUnified } from '../engine/shared/exec-tool.js';
import { loadTransportCredentials } from './transport.js';

test('internal tool calls reach the HTTPS/2 server with certificate verification', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-h2-tool-'));
  const tls = await loadTransportCredentials(dir, {});
  const app = Fastify({ http2: true, https: { key: tls.key, cert: tls.cert, allowHTTP1: true } });
  app.post('/api/tools/exec', async () => ({ result: 'tool-ok' }));
  const previous = {
    TOOL_BRIDGE_URL: process.env.TOOL_BRIDGE_URL,
    FOURTORM_INTERNAL_CERT_FILE: process.env.FOURTORM_INTERNAL_CERT_FILE,
  };
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    process.env.TOOL_BRIDGE_URL = address;
    process.env.FOURTORM_INTERNAL_CERT_FILE = tls.certPath;
    assert.equal(await execToolUnified({ tool: 'test_tool', args: {}, agentId: 'test' }), 'tool-ok');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
