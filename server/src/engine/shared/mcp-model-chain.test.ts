import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initMcpManager, shutdownMcpManager, getMcpToolDefs } from './mcp-manager.js';
import { execToolUnifiedOutcome } from './exec-tool.js';
import { callLLM } from './llm-bridge.js';
import { runReActLoopNative, type LLMCaller } from './react/native-loop.js';
import { runReActLoop } from './react/text-loop.js';
import type { ContextMessage } from './types.js';

const PIXELS = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDrsAAAAASUVORK5CYII=';
const ARGUMENTS = { count: 68422, enabled: false, viewport: [0, 0, 100, 100], optional: null,
  options: { crop: true }, literal: 'false' };
const SERVER = `import readline from 'node:readline';
const input = readline.createInterface({input:process.stdin});
input.on('line', line => {
  const message = JSON.parse(line);
  if(message.id === undefined) return;
  let result;
  if(message.method === 'initialize') result = {protocolVersion:'2024-11-05'};
  else if(message.method === 'tools/list') result = {tools:[{name:'capture',description:'Capture fixture',inputSchema:{type:'object'}}]};
  else {
    const valid = JSON.stringify(message.params.arguments) === ${JSON.stringify(JSON.stringify(ARGUMENTS))};
    result = {isError:!valid,content:[{type:'text',text:JSON.stringify({observation_id:'fixture-observation',typed:valid})},
      {type:'image',mimeType:'image/png',data:${JSON.stringify(PIXELS)}}],structuredContent:{bound_window:'fixture-window'}};
  }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
});`;

for (const transport of ['native', 'text'] as const) test(`real MCP ${transport} chain preserves types, metadata and model image input after history reload`, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-mcp-chain-'));
  t.after(async () => { shutdownMcpManager();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await fs.mkdir(path.join(directory, 'mcp'), { recursive: true });
  await fs.mkdir(path.join(directory, 'agents'), { recursive: true });
  await fs.writeFile(path.join(directory, 'agents', 'registry.json'), JSON.stringify({
    'fixture-agent': { id: 'fixture-agent', config: { tools: ['mcp:fixture:capture'],
      toolMode: 'selected', skills: [] } },
  }));
  const script = path.join(directory, 'fixture.mjs');
  await fs.writeFile(script, SERVER);
  await fs.writeFile(path.join(directory, 'mcp', 'servers.json'), JSON.stringify([{
    name: 'fixture', transport: 'stdio', enabled: true, command: process.execPath, args: [script], env: {},
  }]));
  await fs.writeFile(path.join(directory, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://example.test/v1', models: ['demo'],
    modelCapabilities: { demo: { vision: { status: 'supported', checkedAt: 'now' } } },
  }] }));
  await initMcpManager(directory);
  const definitions = getMcpToolDefs();
  assert.equal(definitions.length, 1);
  let requests = 0;
  let imageRequests = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests++;
    if (requests === 1) {
      const name = transport === 'native' ? body.tools[0].function.name : definitions[0].name;
      const message = transport === 'native'
        ? { content: '', tool_calls: ['first', 'second'].map(id => ({ id, type: 'function',
          function: { name, arguments: JSON.stringify(ARGUMENTS) } })) }
        : { content: JSON.stringify({ type: 'tool_call', name, arguments: ARGUMENTS }) };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: transport === 'native' ? 'tool_calls' : 'stop' }] }));
    }
    const resultMessages = body.messages.filter((item: {role: string}) => item.role === 'tool');
    if (transport === 'native') {
      assert.equal(resultMessages.length, 2);
      const lastTool = body.messages.findLastIndex((item: {role: string}) => item.role === 'tool');
      assert.equal(body.messages[lastTool + 1].role, 'user');
    }
    const parts = body.messages.flatMap((item: {content: unknown}) => Array.isArray(item.content) ? item.content : []);
    const images = parts.filter((item: {type: string}) => item.type === 'image_url');
    assert.equal(images.length, transport === 'native' ? 2 : 1);
    assert.equal(images[0].image_url.url, `data:image/png;base64,${PIXELS}`);
    const texts = JSON.stringify(body.messages.map((item: {content: unknown}) => Array.isArray(item.content)
      ? item.content.filter(part => part.type === 'text') : item.content));
    assert.match(texts, /fixture-observation/);
    assert.match(texts, /fixture-window/);
    assert.doesNotMatch(texts, new RegExp(PIXELS.slice(0, 35)));
    imageRequests++;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'fixture complete' }, finish_reason: 'stop' }] }));
  });
  const messages: ContextMessage[] = [{ role: 'user', content: 'Inspect fixture' }];
  const llm: LLMCaller = { call: (history, _options, _chunk, signal, tools) => callLLM({
    dataDir: directory, fullModelKey: 'p:demo', messages: history, signal, tools,
  }) };
  const run = transport === 'native' ? runReActLoopNative : runReActLoop;
  const outcome = await run({ messages, llm, toolDefs: definitions, allowedTools: definitions.map(item => item.name),
    tools: { call: (tool, args) => execToolUnifiedOutcome({ tool, args, agentId: 'fixture-agent' }) }, maxTurns: 3 });
  assert.equal(outcome.termination.status, 'succeeded');
  assert.equal(outcome.toolCalls.every(item => item.toolImages?.length === 1), true);
  assert.equal(outcome.toolCalls.every(item => item.result.includes('"typed":true')), true);
  const stored = JSON.stringify(messages);
  assert.doesNotMatch(stored, new RegExp(PIXELS.slice(0, 35)));
  await callLLM({ dataDir: directory, fullModelKey: 'p:demo', messages: JSON.parse(stored),
    tools: transport === 'native' ? definitions : undefined });
  assert.equal(requests, 3);
  assert.equal(imageRequests, 2);
});
