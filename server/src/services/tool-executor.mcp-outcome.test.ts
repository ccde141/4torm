import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initMcpManager, shutdownMcpManager } from '../engine/shared/mcp-manager.js';
import { writeMcpConfigs } from '../engine/shared/mcp-config-store.js';
import { executeTool, executeToolOutcome } from './tool-executor.js';

test('authorized MCP execution retains isError beside the legacy string result', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-mcp-outcome-'));
  const dataDir = path.join(root, 'data');
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2024-11-05' }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] }
        : { isError: true, content: [{ type: 'text', text: 'permission denied' }] };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    shutdownMcpManager();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', config: { tools: ['mcp:test:inspect'], toolMode: 'selected', skills: [] } },
  }));
  await writeMcpConfigs(dataDir, [{ name: 'test', enabled: true, transport: 'streamable-http',
    url: `http://127.0.0.1:${address.port}/mcp`, headers: {} }]);
  await initMcpManager(dataDir);

  assert.deepEqual(await executeToolOutcome(dataDir, 'mcp:test:inspect', {}, 'agent'),
    { result: 'permission denied', ok: false });
  assert.equal(await executeTool(dataDir, 'mcp:test:inspect', {}, 'agent'), 'permission denied');
});
