import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { McpHttpClient } from './mcp-http-client.js';
import { createMcpRequestScope, MCP_REQUEST_TIMEOUT_MS } from './mcp-request.js';

async function fixture(t: test.TestContext, holdType?: string) {
  let started!: () => void;
  const startedCall = new Promise<void>(resolve => { started = resolve; });
  const server = createServer(async (request, response) => {
    if (request.method === 'DELETE') { response.end(); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (body.id === undefined) { response.writeHead(202).end(); return; }
    if (body.method === 'tools/call' && holdType) {
      response.writeHead(200, { 'content-type': holdType });
      response.write(holdType.includes('json') ? '{"jsonrpc":"2.0"' : ': waiting\n\n');
      started();
      return;
    }
    const result = body.method === 'initialize' ? { protocolVersion: '2024-11-05' }
      : body.method === 'tools/list' ? { tools: [{ name: 'inspect' }] }
        : { content: [{ type: 'text', text: 'result' }] };
    const malformed = body.params?.arguments?.malformed;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: malformed === 'version' ? '1.0' : '2.0',
      id: malformed === 'id' ? 999999 : body.id, result,
      ...(malformed === 'both' ? { error: { code: -1, message: 'bad' } } : {}) }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const client = new McpHttpClient({ name: 'test', enabled: true, transport: 'streamable-http',
    url: `http://127.0.0.1:${address.port}/mcp`, headers: {} });
  t.after(async () => {
    client.disconnect();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  await client.connect();
  return { client, startedCall };
}

for (const contentType of ['application/json', 'text/event-stream']) {
  test(`MCP HTTP 取消覆盖 ${contentType} 响应体读取`, { timeout: 2_000 }, async t => {
    const { client, startedCall } = await fixture(t, contentType);
    const controller = new AbortController();
    const call = client.callToolOutcome('inspect', {}, controller.signal);
    const rejection = assert.rejects(call, { name: 'AbortError' });
    await startedCall;
    controller.abort();
    await rejection;
  });
}

test('MCP HTTP disconnect 中止尚未完成的响应体', { timeout: 2_000 }, async t => {
  const { client, startedCall } = await fixture(t, 'application/json');
  const rejection = assert.rejects(client.callToolOutcome('inspect', {}), { name: 'AbortError' });
  await startedCall;
  client.disconnect();
  await rejection;
});

test('MCP HTTP JSON 验证请求 ID、协议版本和互斥结果字段', async t => {
  const { client } = await fixture(t);
  for (const malformed of ['id', 'version', 'both']) {
    await assert.rejects(client.callToolOutcome('inspect', { malformed }), /JSON-RPC/);
  }
  assert.equal((await client.callToolOutcome('inspect', {})).ok, true);
});

test('MCP 请求期限是有限的，提前释放不会留下超时', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const active = createMcpRequestScope();
  const released = createMcpRequestScope();
  released.dispose();
  t.mock.timers.tick(MCP_REQUEST_TIMEOUT_MS);
  assert.equal(active.signal.aborted, true);
  assert.equal(active.signal.reason.name, 'TimeoutError');
  assert.equal(released.signal.aborted, false);
  active.dispose();
});

test('MCP HTTP 已匹配结果或通知后，不等待外部永不结束的 cancel 清理', { timeout: 2_000 }, async t => {
  const encoder = new TextEncoder();
  const hangingBody = (text: string) => new ReadableStream<Uint8Array>({
    start(controller) { if (text) controller.enqueue(encoder.encode(text)); },
    cancel: () => new Promise<void>(() => {}),
  });
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body ?? '{}'));
    if (message.method === 'notifications/initialized') return new Response(hangingBody(''), { status: 202 });
    if (message.method === 'tools/call') {
      const result = { content: [{ type: 'text', text: 'completed' }] };
      return new Response(hangingBody(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0', id: message.id, result,
      })}\n\n`), { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id,
      result: message.method === 'tools/list' ? { tools: [{ name: 'inspect' }] } : {} }),
    { headers: { 'content-type': 'application/json' } });
  });
  const client = new McpHttpClient({ name: 'test', enabled: true, transport: 'streamable-http',
    url: 'http://fixture.invalid/mcp', headers: {} });
  t.after(() => client.disconnect());
  await client.connect();
  assert.equal(await client.callTool('inspect', {}), 'completed');
});
