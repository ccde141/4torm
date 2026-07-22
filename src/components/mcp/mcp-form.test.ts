import assert from 'node:assert/strict';
import test from 'node:test';
import { formFromServer, parseMcpConfigJson, payloadFromForm } from './mcp-form.js';

test('stdio 表单往返时保持含空格参数和 cwd', () => {
  const form = formFromServer({
    name: 'local', enabled: true, transport: 'stdio', command: 'node',
    args: ['server.js', 'C:\\Folder With Spaces'], env: { TOKEN: 'value' }, cwd: 'C:\\MCP Servers',
    connected: false, toolCount: 0,
  });
  const payload = payloadFromForm(form);

  assert.deepEqual(payload.args, ['server.js', 'C:\\Folder With Spaces']);
  assert.equal(payload.cwd, 'C:\\MCP Servers');
  assert.deepEqual(payload.env, { TOKEN: 'value' });
});

test('远程表单只输出 URL 与请求头', () => {
  const form = formFromServer({
    name: 'remote', enabled: true, transport: 'streamable-http',
    url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' },
    connected: false, toolCount: 0,
  });
  const payload = payloadFromForm(form);

  assert.equal(payload.transport, 'streamable-http');
  assert.equal(payload.url, 'https://example.com/mcp');
  assert.deepEqual(payload.headers, { Authorization: 'Bearer token' });
  assert.equal('command' in payload, false);
});

test('JSON 导入兼容 mcpServers 包装和常见 http 别名', () => {
  const configs = parseMcpConfigJson(JSON.stringify({
    mcpServers: {
      local: { command: 'npx', args: ['-y', 'local-server'] },
      remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token' } },
    },
  }));

  assert.deepEqual(configs.map(config => [config.name, config.transport]), [
    ['local', 'stdio'], ['remote', 'streamable-http'],
  ]);
});

test('JSON 导入拒绝缺少启动信息的服务', () => {
  assert.throws(() => parseMcpConfigJson('{"mcpServers":{"broken":{}}}'), /启动命令/);
});
