import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { McpHttpClient } from './mcp-http-client.js';

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, id: unknown, result: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

test('Streamable HTTP 完成握手、Session 传递与工具调用', async (t) => {
  const seenSessions: string[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test');
    const body = await readJson(req);
    const method = body.method;
    if (method === 'initialize') {
      res.setHeader('Mcp-Session-Id', 'session-1');
      sendJson(res, body.id, { protocolVersion: '2024-11-05' });
      return;
    }
    if (req.headers['mcp-session-id']) seenSessions.push(String(req.headers['mcp-session-id']));
    if (method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; }
    if (method === 'tools/list') {
      sendJson(res, body.id, { tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }] });
      return;
    }
    sendJson(res, body.id, { content: [{ type: 'text', text: 'remote result' }] });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address === 'object');

  const client = new McpHttpClient({
    name: 'remote', enabled: true, transport: 'streamable-http',
    url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: 'Bearer test' },
  });
  await client.connect();
  t.after(() => client.disconnect());

  assert.deepEqual(client.tools.map(tool => tool.name), ['search']);
  assert.equal(await client.callTool('search', { q: 'hello' }), 'remote result');
  assert(seenSessions.every(value => value === 'session-1'));
});
