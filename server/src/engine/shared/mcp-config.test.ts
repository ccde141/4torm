import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMcpConfig } from './mcp-config.js';

test('旧 stdio 配置保持参数边界并支持 cwd', () => {
  const config = normalizeMcpConfig({
    name: 'local-files',
    command: 'node',
    args: ['server.js', 'C:\\Folder With Spaces'],
    env: { TOKEN: 'secret' },
    cwd: 'C:\\MCP Servers',
  });

  assert.equal(config.transport, 'stdio');
  assert.deepEqual(config.args, ['server.js', 'C:\\Folder With Spaces']);
  assert.equal(config.cwd, 'C:\\MCP Servers');
});

test('远程 MCP 配置保留 URL 和请求头', () => {
  const http = normalizeMcpConfig({
    name: 'remote-http',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
  });
  const sse = normalizeMcpConfig({
    name: 'remote-sse',
    transport: 'sse',
    url: 'https://example.com/events',
  });

  assert.equal(http.transport, 'streamable-http');
  assert.deepEqual(http.headers, { Authorization: 'Bearer token' });
  assert.equal(sse.transport, 'sse');
});

test('配置缺少当前传输所需字段时真实报错', () => {
  assert.throws(
    () => normalizeMcpConfig({ name: 'broken', transport: 'stdio' }),
    /command/,
  );
  assert.throws(
    () => normalizeMcpConfig({ name: 'broken', transport: 'streamable-http' }),
    /url/,
  );
});
