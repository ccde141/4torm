import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { McpSseClient } from './mcp-sse-client.js';

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

test('兼容 SSE 从 endpoint 事件完成握手与工具调用', async (t) => {
  let stream: ServerResponse | undefined;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      stream = res;
      res.write('event: endpoint\ndata: /message\n\n');
      return;
    }
    const body = await readJson(req);
    res.statusCode = 202;
    res.end();
    if (body.id === undefined) return;
    const method = body.method;
    const result = method === 'initialize'
      ? { protocolVersion: '2024-11-05' }
      : method === 'tools/list'
        ? { tools: [{ name: 'lookup', description: 'Lookup', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'sse result' }] };
    stream?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');

  const client = new McpSseClient({
    name: 'legacy', enabled: true, transport: 'sse',
    url: `http://127.0.0.1:${address.port}/events`, headers: {},
  });
  t.after(() => {
    client.disconnect();
    stream?.destroy();
    server.closeAllConnections();
    server.close();
  });
  await client.connect();

  assert.deepEqual(client.tools.map(tool => tool.name), ['lookup']);
  assert.equal(await client.callTool('lookup', {}), 'sse result');
});
