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
  else result = { content: [{ type: 'text', text: process.argv[2] + '|' + process.cwd() }] };
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
});
