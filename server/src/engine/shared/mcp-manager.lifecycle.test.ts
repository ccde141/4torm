import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ServerResponse } from 'node:http';
import test from 'node:test';
import { writeMcpConfigs } from './mcp-config-store.js';
import { initMcpManager, shutdownMcpManager, reconnectServer, disconnectServer,
  getMcpStatus, getMcpToolDefs, callMcpToolOutcome } from './mcp-manager.js';
import { execToolUnifiedOutcome } from './exec-tool.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-mcp-lifecycle-'));
  let hold = false;
  let pending: ServerResponse | undefined;
  let pendingId: unknown;
  let calls = 0;
  let initializations = 0;
  let failedLists = 0;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const server = createServer(async (request, response) => {
    if (request.method === 'DELETE') { response.end(); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (body.id === undefined) { response.writeHead(202).end(); return; }
    if (body.method === 'initialize') initializations++;
    if (body.method === 'tools/list' && failedLists > 0) {
      failedLists--;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id,
        error: { code: -32000, message: 'temporary tool discovery failure' } }));
      return;
    }
    const result = body.method === 'initialize' ? { protocolVersion: '2024-11-05' }
      : body.method === 'tools/list' ? { tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'executed' }] };
    if (body.method === 'tools/call') calls++;
    if (hold && body.method === 'initialize') {
      pending = response; pendingId = body.id; started(); return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  await writeMcpConfigs(dataDir, [{ name: 'test', enabled: true, transport: 'streamable-http',
    url: `http://127.0.0.1:${address.port}/mcp`, headers: {} }]);
  t.after(async () => {
    shutdownMcpManager();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return { dataDir, start, hold: () => { hold = true; }, calls: () => calls,
    initializations: () => initializations,
    failLists: (count: number) => { failedLists = count; },
    release() {
      pending?.setHeader('content-type', 'application/json');
      pending?.end(JSON.stringify({ jsonrpc: '2.0', id: pendingId, result: {} }));
    } };
}

test('删除配置并断开 pending MCP 后，迟到初始化不能恢复工具', async t => {
  const f = await fixture(t);
  await initMcpManager(f.dataDir);
  f.hold();
  const connecting = reconnectServer(f.dataDir, 'test');
  await f.start;
  await writeMcpConfigs(f.dataDir, []);
  disconnectServer('test');
  f.release();
  await connecting;
  assert.deepEqual(getMcpStatus(), []);
  assert.deepEqual(getMcpToolDefs(), []);
  await assert.rejects(callMcpToolOutcome('mcp:test:inspect', {}), /工具不存在/);
  assert.equal(f.calls(), 0);
});

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('MCP lifecycle condition did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('MCP 首次连接失败后按健康周期恢复，每周期只重连一次', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = await fixture(t);
  f.failLists(2);
  await initMcpManager(f.dataDir);
  assert.equal(f.initializations(), 1);
  assert.deepEqual(getMcpToolDefs(), []);

  t.mock.timers.tick(60_000);
  await eventually(() => f.initializations() === 2);
  // Wait for the failed request to settle before advancing another health cycle.
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(getMcpToolDefs(), []);
  assert.equal(f.initializations(), 2);

  t.mock.timers.tick(60_000);
  await eventually(() => getMcpToolDefs().length === 1);
  assert.equal(f.initializations(), 3);
  assert.equal(f.calls(), 0);
});

test('MCP 健康检查断线后恢复工具，不重放已执行的工具调用', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = await fixture(t);
  await initMcpManager(f.dataDir);
  assert.equal((await callMcpToolOutcome('mcp:test:inspect', {})).result, 'executed');
  f.failLists(1);
  t.mock.timers.tick(60_000);
  await eventually(() => f.initializations() === 2 && getMcpToolDefs().length === 1);
  assert.equal(f.calls(), 1);
});

test('MCP 重连未完成时不启动重叠健康轮，shutdown 拒绝迟到恢复', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = await fixture(t);
  await initMcpManager(f.dataDir);
  f.failLists(1);
  f.hold();
  t.mock.timers.tick(60_000);
  await f.start;
  t.mock.timers.tick(180_000);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.initializations(), 2);
  shutdownMcpManager();
  f.release();
  await new Promise(resolve => setTimeout(resolve, 30));
  t.mock.timers.tick(60_000);
  assert.deepEqual(getMcpStatus(), []);
  assert.deepEqual(getMcpToolDefs(), []);
  assert.equal(f.initializations(), 2);
  assert.equal(f.calls(), 0);
});

test('MCP 已停用的失败连接不会被健康周期恢复', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = await fixture(t);
  f.failLists(1);
  await initMcpManager(f.dataDir);
  await writeMcpConfigs(f.dataDir, []);
  t.mock.timers.tick(60_000);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.initializations(), 1);
  assert.deepEqual(getMcpToolDefs(), []);
  assert.equal(f.calls(), 0);
});

test('初始化期间 shutdown 不注册迟到连接或配置 watcher', async t => {
  const f = await fixture(t);
  f.hold();
  const initializing = initMcpManager(f.dataDir);
  await f.start;
  shutdownMcpManager();
  f.release();
  await initializing;
  assert.deepEqual(getMcpStatus(), []);
  assert.deepEqual(getMcpToolDefs(), []);
});

test('统一 MCP 执行重读 Agent 授权，撤权后不再调用远端', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.dataDir, 'agents'), { recursive: true });
  const registry = path.join(f.dataDir, 'agents', 'registry.json');
  const writeBindings = (tools: string[]) => fs.writeFile(registry, JSON.stringify({
    agent: { id: 'agent', config: { tools, toolMode: 'selected', skills: [] } },
  }));
  await writeBindings(['mcp:test:inspect']);
  await initMcpManager(f.dataDir);
  const options = { tool: 'mcp:test:inspect', args: {}, agentId: 'agent' };
  assert.equal((await execToolUnifiedOutcome(options)).ok, true);
  await writeBindings([]);
  await assert.rejects(execToolUnifiedOutcome(options), /未获准使用工具/);
  assert.equal(f.calls(), 1);
});
