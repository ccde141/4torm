import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { mcpRoutes } from './mcp.js';

async function createApp(t: test.TestContext): Promise<{ app: ReturnType<typeof Fastify>; dataDir: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-mcp-route-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(mcpRoutes, { prefix: '/api/mcp' });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { app, dataDir };
}

test('MCP API 保存 Streamable HTTP 与兼容 SSE 配置', async t => {
  const { app, dataDir } = await createApp(t);
  const http = await app.inject({ method: 'POST', url: '/api/mcp/add', payload: {
    name: 'remote-http', enabled: false, transport: 'streamable-http',
    url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' },
  } });
  const sse = await app.inject({ method: 'POST', url: '/api/mcp/add', payload: {
    name: 'remote-sse', enabled: false, transport: 'sse',
    url: 'https://example.com/events', headers: {},
  } });

  assert.equal(http.statusCode, 200);
  assert.equal(sse.statusCode, 200);
  const configs = JSON.parse(await fs.readFile(path.join(dataDir, 'mcp', 'servers.json'), 'utf8'));
  assert.deepEqual(configs.map((item: { transport: string }) => item.transport), ['streamable-http', 'sse']);
});

test('MCP API 保留旧 stdio 默认值和精确参数数组', async t => {
  const { app, dataDir } = await createApp(t);
  const response = await app.inject({ method: 'POST', url: '/api/mcp/add', payload: {
    name: 'local', enabled: false, command: 'node',
    args: ['server.js', 'C:\\Folder With Spaces'], cwd: 'C:\\MCP Servers',
  } });

  assert.equal(response.statusCode, 200);
  const [config] = JSON.parse(await fs.readFile(path.join(dataDir, 'mcp', 'servers.json'), 'utf8'));
  assert.equal(config.transport, 'stdio');
  assert.deepEqual(config.args, ['server.js', 'C:\\Folder With Spaces']);
  assert.equal(config.cwd, 'C:\\MCP Servers');
});

test('MCP API 拒绝缺少 URL 的远程配置', async t => {
  const { app } = await createApp(t);
  const response = await app.inject({ method: 'POST', url: '/api/mcp/add', payload: {
    name: 'broken', enabled: false, transport: 'streamable-http',
  } });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /url/);
});

test('MCP API 原子导入多项配置并拒绝整批重名', async t => {
  const { app, dataDir } = await createApp(t);
  const payload = { configs: [
    { name: 'local', enabled: false, transport: 'stdio', command: 'node', args: ['server.js'] },
    { name: 'remote', enabled: false, transport: 'streamable-http', url: 'https://example.com/mcp' },
  ] };
  const imported = await app.inject({ method: 'POST', url: '/api/mcp/import', payload });
  assert.equal(imported.statusCode, 200);

  const duplicate = await app.inject({ method: 'POST', url: '/api/mcp/import', payload: {
    configs: [{ name: 'fresh', command: 'node' }, { name: 'local', command: 'node' }],
  } });
  assert.equal(duplicate.statusCode, 409);
  const configs = JSON.parse(await fs.readFile(path.join(dataDir, 'mcp', 'servers.json'), 'utf8'));
  assert.deepEqual(configs.map((item: { name: string }) => item.name), ['local', 'remote']);
});
