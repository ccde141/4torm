import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initMcpManager, shutdownMcpManager } from './mcp-manager.js';
import { writeMcpConfigs } from './mcp-config-store.js';
import { runNativeSubAgent, type NativeSubAgentEvent } from './native-sub-agent-runner.js';

function toolStream(name: string, id: string, args: Record<string, string>): string {
  const payload = { choices: [{ delta: { tool_calls: [{
    index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) },
  }] }, finish_reason: 'tool_calls' }] };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

test('native SubAgent forwards MCP isError once without masking it as success', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-native-mcp-'));
  const dataDir = path.join(root, 'data');
  let modelCalls = 0;
  let mcpCalls = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (request.url === '/v1/chat/completions') {
      modelCalls++;
      response.setHeader('Content-Type', 'text/event-stream');
      response.end(modelCalls === 1
        ? toolStream('mcp:test:inspect', 'call_mcp', {})
        : toolStream('done', 'call_done', { summary: 'MCP failed' }));
      return;
    }
    if (body.id === undefined) { response.writeHead(202).end(); return; }
    const result = body.method === 'initialize'
      ? { protocolVersion: '2024-11-05' }
      : body.method === 'tools/list'
        ? { tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] }
        : { isError: true, content: [{ type: 'text', text: 'permission denied' }] };
    if (body.method === 'tools/call') mcpCalls++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    shutdownMcpManager();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'local', baseUrl: `${baseUrl}/v1`, models: ['test'],
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
  }] }));
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', config: { tools: ['mcp:test:inspect'], toolMode: 'selected', skills: [] } },
  }));
  await writeMcpConfigs(dataDir, [{ name: 'test', enabled: true, transport: 'streamable-http',
    url: `${baseUrl}/mcp`, headers: {} }]);
  await initMcpManager(dataDir);

  const events: NativeSubAgentEvent[] = [];
  const result = await runNativeSubAgent({
    agent: { id: 'agent', name: 'agent', model: 'local:test', rolePrompt: '',
      temperature: 0, tools: ['mcp:test:inspect'], toolMode: 'selected', skills: [],
      workspace: 'data/agents/agent/.workspace/', sandboxLevel: 'project' },
    model: 'local:test', tools: [
      { name: 'mcp:test:inspect', description: 'inspect', parameters: { type: 'object' } },
      { name: 'done', description: 'finish', parameters: { type: 'object' } },
    ],
    systemPrompt: '', task: 'inspect', context: '', dataDir, sandboxSection: '',
    escalationNote: '', constraintsSection: '', maxRounds: 3,
    signal: new AbortController().signal, emitEvent: event => events.push(event),
    parentSandboxLevel: 'project',
  });
  assert.equal(result.status, 'success');
  assert.equal(mcpCalls, 1);
  assert.deepEqual(events.filter(event => event.type === 'tool_result'), [{
    type: 'tool_result', data: { tool: 'mcp:test:inspect', result: 'permission denied', ok: false },
  }]);
});
