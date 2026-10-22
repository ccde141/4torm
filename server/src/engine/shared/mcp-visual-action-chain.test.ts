import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { initMcpManager, shutdownMcpManager, getMcpToolDefs } from './mcp-manager.js';
import { execToolUnifiedOutcome } from './exec-tool.js';
import { callLLM } from './llm-bridge.js';
import { runReActLoopNative, type LLMCaller } from './react/native-loop.js';
import { runReActLoop } from './react/text-loop.js';
import type { ContextMessage } from './types.js';
import type { ToolArguments } from './tool-arguments.js';

function pixel(red: number, green: number): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, red, green, 0, 255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const BEFORE = pixel(255, 0), AFTER = pixel(0, 255);
const ACTION = { type: 'click', position: { x: 0, y: 0 }, buttons: [0],
  modifiers: { shift: false }, delay_ms: 0, optional: null };
const TOOLS = [
  { name: 'observe', description: 'Observe the fixture',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'act', description: 'Act using the current observation', inputSchema: {
    type: 'object', required: ['observation_id', 'action'], properties: {
      observation_id: { type: 'string' }, action: { type: 'object', required: ['position'], properties: {
        position: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } } },
      } },
    },
  } },
  { name: 'status', description: 'Read fixture counts', inputSchema: { type: 'object' } },
];
const SERVER = `import readline from 'node:readline';
let revision=0, observation='', observeCalls=0, actCalls=0, successfulActions=0;
const result = (metadata, pixels, error=false) => ({isError:error,content:[
  {type:'text',text:JSON.stringify(metadata)},
  ...(pixels ? [{type:'image',mimeType:'image/png',data:pixels}] : [])]});
readline.createInterface({input:process.stdin}).on('line', line => {
  const message=JSON.parse(line); if(message.id===undefined) return;
  let value;
  if(message.method==='initialize') value={protocolVersion:'2024-11-05'};
  else if(message.method==='tools/list') value={tools:${JSON.stringify(TOOLS)}};
  else {
    const {name,arguments:args}=message.params;
    if(name==='observe') {
      observeCalls++; observation='visual-'+(++revision);
      value=result({observation_id:observation,width:1,height:1,successful_actions:successfulActions},
        successfulActions ? ${JSON.stringify(AFTER)} : ${JSON.stringify(BEFORE)});
    } else if(name==='act') {
      actCalls++;
      if(args.observation_id!==observation) value=result({error:'STALE_OBSERVATION',observation_id:observation,
        act_calls:actCalls,successful_actions:successfulActions},null,true);
      else if(JSON.stringify(args.action)!==${JSON.stringify(JSON.stringify(ACTION))}) {
        value=result({error:'INVALID_TYPED_ACTION'},null,true);
      } else {
        successfulActions++; observation='visual-'+(++revision);
        value=result({observation_id:observation,typed:true,act_calls:actCalls,successful_actions:successfulActions},${JSON.stringify(AFTER)});
      }
    } else value=result({observe_calls:observeCalls,act_calls:actCalls,successful_actions:successfulActions},null);
  }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:value})+'\\n');
});`;

interface RequestMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
}
interface ModelBody {
  messages: RequestMessage[];
  tools?: Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
}

function textParts(message: RequestMessage): string[] {
  return typeof message.content === 'string' ? [message.content]
    : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '');
}

function metadata(body: ModelBody): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  for (const message of body.messages) for (const text of textParts(message)) {
    let content = text;
    if (message.role !== 'tool') {
      try {
        const envelope = JSON.parse(text);
        if (envelope.type !== 'tool_result') continue;
        content = envelope.content;
      } catch { continue; }
    }
    try { output.push(JSON.parse(content.replace(/^Error:\s*/, '').split('\n')[0])); }
    catch { /* The image attribution message contains no result JSON. */ }
  }
  return output;
}

function assertPictures(body: ModelBody, expected: string[]): void {
  const urls = body.messages.flatMap(message => typeof message.content === 'string' ? []
    : (message.content ?? []).filter(part => part.type === 'image_url').map(part => part.image_url?.url));
  assert.deepEqual(urls, expected.map(pixels => `data:image/png;base64,${pixels}`));
  const texts = body.messages.flatMap(textParts).join('\n');
  for (const pixels of [BEFORE, AFTER]) assert.equal(texts.includes(pixels), false);
}

for (const mode of ['native', 'text'] as const) test(`MCP ${mode} autonomous observe/action loop refreshes images and rejects stale actions without replay`, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-mcp-visual-loop-'));
  t.after(async () => {
    shutdownMcpManager();
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('4torm-mcp-visual-loop-')) throw new Error('Invalid fixture cleanup');
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  await fs.mkdir(path.join(directory, 'mcp'), { recursive: true });
  await fs.mkdir(path.join(directory, 'agents'), { recursive: true });
  await fs.writeFile(path.join(directory, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', config: { tools: ['mcp:visual:*'], toolMode: 'selected', skills: [] } },
  }));
  const script = path.join(directory, 'visual-fixture.mjs');
  await fs.writeFile(script, SERVER);
  await fs.writeFile(path.join(directory, 'mcp', 'servers.json'), JSON.stringify([{
    name: 'visual', transport: 'stdio', enabled: true, command: process.execPath, args: [script], env: {},
  }]));
  await fs.writeFile(path.join(directory, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://example.test/v1', models: ['demo'],
    modelCapabilities: { demo: { vision: { status: 'supported', checkedAt: 'fixture' } } },
  }] }));
  await initMcpManager(directory);
  const definitions = getMcpToolDefs();
  assert.equal(definitions.length, 3);
  let requests = 0, initialObservation = '', updatedObservation = '';
  let modelAssertion: unknown;
  const toolResponse = (body: ModelBody, action: string, args: ToolArguments) => {
    const name = mode === 'native'
      ? body.tools?.find(tool => tool.function.name.endsWith(`_${action}`))?.function.name
      : `mcp:visual:${action}`;
    assert(name);
    const message = mode === 'native' ? { content: '', tool_calls: [{ id: `call-${requests}`, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] }
      : { content: JSON.stringify({ type: 'tool_call', name, arguments: args }) };
    return new Response(JSON.stringify({ choices: [{ message, finish_reason: mode === 'native' ? 'tool_calls' : 'stop' }] }));
  };
  const answer = (content: string) => new Response(JSON.stringify({ choices: [{
    message: { content }, finish_reason: 'stop',
  }] }));
  const respondToModel = async (init?: RequestInit) => {
    const body: ModelBody = JSON.parse(String(init?.body));
    requests++;
    assertPictures(body, requests === 1 ? [] : requests === 2 ? [BEFORE] : [BEFORE, AFTER]);
    if (requests === 1) {
      if (mode === 'native') {
        const parameters = body.tools?.find(tool => tool.function.name.endsWith('_act'))?.function.parameters;
        assert.deepEqual(parameters?.required, ['observation_id', 'action']);
      }
      return toolResponse(body, 'observe', {});
    }
    const latest = metadata(body).at(-1);
    assert(latest);
    if (requests === 2) {
      assert.equal(latest.width, 1, JSON.stringify(latest));
      initialObservation = String(latest.observation_id);
      return toolResponse(body, 'act', { observation_id: initialObservation, action: ACTION });
    }
    if (requests === 3) {
      assert.equal(latest.typed, true);
      assert.equal(latest.successful_actions, 1);
      updatedObservation = String(latest.observation_id);
      assert.notEqual(updatedObservation, initialObservation);
      return answer('Updated green screenshot confirms completion.');
    }
    if (requests === 4) return toolResponse(body, 'act', { observation_id: initialObservation, action: ACTION });
    assert.equal(requests, 5, 'A tool failure must not cause an automatic model/tool replay');
    assert.equal(latest.error, 'STALE_OBSERVATION');
    assert.equal(latest.observation_id, updatedObservation);
    assert.equal(latest.act_calls, 2);
    assert.equal(latest.successful_actions, 1);
    return answer('Stale observation was rejected; no action was repeated.');
  };
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    try { return await respondToModel(init); }
    catch (error) { modelAssertion = error; throw error; }
  });
  const llm: LLMCaller = { call: (history, _options, _chunk, signal, tools) => callLLM({
    dataDir: directory, fullModelKey: 'p:demo', messages: history, signal, tools,
  }) };
  const run = mode === 'native' ? runReActLoopNative : runReActLoop;
  const calls: Array<{ name: string; args: ToolArguments; ok: boolean }> = [];
  const tools = { call: async (name: string, args: ToolArguments) => {
    const outcome = await execToolUnifiedOutcome({ tool: name, args, agentId: 'agent' });
    calls.push({ name, args, ok: outcome.ok });
    return outcome;
  } };
  const messages: ContextMessage[] = [{ role: 'user', content: 'Observe the fixture, click once, verify the updated image.' }];
  const first = await run({ messages, llm, tools, toolDefs: definitions,
    allowedTools: definitions.map(tool => tool.name), maxTurns: 4 });
  if (modelAssertion) throw modelAssertion;
  assert.equal(first.termination.status, 'succeeded', JSON.stringify(first.termination));
  assert.match(first.content, /confirms completion/);
  assert.deepEqual(calls.map(call => call.name), ['mcp:visual:observe', 'mcp:visual:act']);
  assert.deepEqual(calls[1].args, { observation_id: initialObservation, action: ACTION });
  assert.equal(first.toolCalls.every(call => call.toolImages?.length === 1), true);

  const saved = JSON.stringify(messages);
  for (const pixels of [BEFORE, AFTER]) assert.equal(saved.includes(pixels), false);
  const reloaded: ContextMessage[] = JSON.parse(saved);
  reloaded.push({ role: 'user', content: 'Check that the old observation cannot be reused.' });
  const second = await run({ messages: reloaded, llm, tools, toolDefs: definitions,
    allowedTools: definitions.map(tool => tool.name), maxTurns: 3 });
  if (modelAssertion) throw modelAssertion;
  assert.equal(second.termination.status, 'succeeded');
  assert.equal(requests, 5);
  assert.deepEqual(calls.map(call => call.ok), [true, true, false]);
  assert.equal(second.toolCalls.length, 1);
  assert.match(second.toolCalls[0].result, /STALE_OBSERVATION/);
  const status = await execToolUnifiedOutcome({ tool: 'mcp:visual:status', args: {}, agentId: 'agent' });
  assert.deepEqual(JSON.parse(status.result), { observe_calls: 1, act_calls: 2, successful_actions: 1 });
});
