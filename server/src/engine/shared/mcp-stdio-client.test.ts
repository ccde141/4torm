import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { McpStdioClient } from './mcp-stdio-client.js';

const SERVER_SOURCE = `
import readline from 'node:readline';
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: '2024-11-05' };
  else if (message.method === 'tools/list') result = { tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object' } }] };
  else result = { content: [{ type: 'text', text: process.argv[2] + '|' + process.cwd() }],
    isError: message.params.arguments.fail === true };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});
`;

test('stdio 保持含空格参数并使用配置的 cwd', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-mcp-stdio-'));
  const script = path.join(directory, 'server.mjs');
  await fs.writeFile(script, SERVER_SOURCE);
  const client = new McpStdioClient({
    name: 'local', enabled: true, transport: 'stdio', command: process.execPath,
    args: [script, 'value with spaces'], env: {}, cwd: directory,
  });
  t.after(async () => {
    client.disconnect();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  await client.connect();
  const result = await client.callTool('inspect', {});
  assert.equal(result, `value with spaces|${directory}`);
  assert.deepEqual(await client.callToolOutcome('inspect', { fail: true }), {
    result: `value with spaces|${directory}`, ok: false,
  });
});

test('stdio 按流解码跨块中文，取消挂起请求后仍能正确调用下一项', { timeout: 5_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-mcp-utf8-'));
  const script = path.join(directory, 'server.mjs');
  await fs.writeFile(script, `
    import readline from 'node:readline';
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const m = JSON.parse(line);
      if (m.id === undefined) return;
      if (m.params?.arguments?.hold) return;
      const result = m.method === 'initialize' ? {} : m.method === 'tools/list'
        ? { tools: [{ name: 'read', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: '你好，文件路径/资料' }] };
      const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
      const at = bytes.indexOf(Buffer.from('你'));
      if (at < 0) process.stdout.write(bytes);
      else {
        process.stdout.write(bytes.subarray(0, at + 1));
        setTimeout(() => process.stdout.write(bytes.subarray(at + 1)), 30);
      }
    });
  `);
  const client = new McpStdioClient({ name: 'unicode', enabled: true, transport: 'stdio',
    command: process.execPath, args: [script], env: {}, cwd: directory });
  t.after(async () => {
    client.disconnect();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  await client.connect();
  const controller = new AbortController();
  const rejected = assert.rejects(client.callToolOutcome('read', { hold: true }, controller.signal),
    { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(await client.callTool('read', {}), '你好，文件路径/资料');
});
