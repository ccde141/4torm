import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { toolRoutes } from '../../routes/tools.js';
import { loadAgentToolDefs } from './tool-defs-loader.js';
import { execToolUnifiedOutcome, type ExecToolDeps } from './exec-tool.js';
import { callLLM } from './llm-bridge.js';
import { runReActLoopNative, type LLMCaller } from './react/native-loop.js';
import { runReActLoop } from './react/text-loop.js';
import { recentToolImage, type ToolMediaScope } from './tool-media-access.js';
import type { ContextMessage } from './types.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII=';

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-local-image-chain-'));
  const dataDir = path.join(root, 'data'), workspace = path.join(root, 'workspace');
  const app = Fastify();
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'agents'));
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'pixel.png'), Buffer.from(PNG, 'base64'));
  for (const file of ['read_image.js', '_resolve.js']) await fs.copyFile(
    new URL(`../../../../data/tools/executors/${file}`, import.meta.url), path.join(dataDir, 'tools', 'executors', file));
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { id: 'worker', config: { tools: ['read_image'], toolMode: 'selected', skills: [] } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://local-image.invalid/v1',
    modelCapabilities: { model: { vision: { status: 'supported', checkedAt: 'fixture' } } },
  }] }));
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  const deps: ExecToolDeps = {
    callMcp: async () => { throw new Error('local tool must not use MCP'); },
    fetcher: async (_url, init) => {
      const response = await app.inject({ method: 'POST', url: '/api/tools/exec', payload: JSON.parse(String(init?.body)) });
      return new Response(response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } });
    },
  };
  const scope: ToolMediaScope = { feature: 'monsoon', target: { agentId: 'worker', sessionId: 'fixture' } };
  const read = (mediaScope = scope) => execToolUnifiedOutcome({ tool: 'read_image', args: { filePath: 'pixel.png' },
    agentId: 'worker', workspaceDir: workspace, mediaAccess: { dataDir, ...mediaScope } }, deps);
  return { dataDir, read, scope };
}

for (const native of [true, false]) {
  test(`${native ? 'native' : 'text'} Agent reads a local image once and receives actual pixels on the next model call`, async t => {
    const f = await fixture(t);
    const definitions = await loadAgentToolDefs(f.dataDir, ['read_image'], [], 'selected');
    let modelCalls = 0, toolCalls = 0;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      modelCalls++;
      if (modelCalls === 1) {
        const message = native ? { content: '', tool_calls: [{ id: 'inspect', type: 'function',
          function: { name: 'read_image', arguments: '{"filePath":"pixel.png"}' } }] }
          : { content: '{"type":"tool_call","name":"read_image","arguments":{"filePath":"pixel.png"}}' };
        return new Response(JSON.stringify({ choices: [{ message, finish_reason: native ? 'tool_calls' : 'stop' }] }));
      }
      const pictures = body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content)
        ? message.content.filter(part => part.type === 'image_url') : []);
      assert.equal(pictures.length, 1);
      assert.equal(pictures[0].image_url.url, `data:image/png;base64,${PNG}`);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'fixture pixels received' }, finish_reason: 'stop' }] }));
    });
    const messages: ContextMessage[] = [{ role: 'user', content: 'Inspect pixel.png' }];
    const llm: LLMCaller = { call: (history, _options, _chunk, signal, tools) => callLLM({
      dataDir: f.dataDir, fullModelKey: 'fixture:model', messages: history, signal, tools,
    }) };
    const result = await (native ? runReActLoopNative : runReActLoop)({ messages, llm,
      toolDefs: definitions, allowedTools: ['read_image'], maxTurns: 3,
      tools: { call: async () => { toolCalls++; return f.read(); } } });
    assert.match(result.content, /pixels received/);
    assert.equal(toolCalls, 1);
    assert.equal(modelCalls, 2);
    assert.doesNotMatch(JSON.stringify(messages), /base64|iVBOR|inlineImages/);
    assert.ok(messages.some(message => message.toolImages?.length));
    await callLLM({ dataDir: f.dataDir, fullModelKey: 'fixture:model', messages: JSON.parse(JSON.stringify(messages)) });
    assert.equal(toolCalls, 1);
  });
}

test('all feature media scopes receive local image references through the same tool bridge', async t => {
  const f = await fixture(t);
  const scopes: ToolMediaScope[] = [f.scope,
    { feature: 'cyclone', target: { workshopId: 'workshop', kind: 'seat', targetId: 'seat' } },
    { feature: 'tradewind', target: { workflowId: 'workflow', executionId: 'execution', nodeId: 'node', kind: 'node' } },
    { feature: 'tide', target: { agentId: 'worker', sessionId: 'tide' } },
    { feature: 'convection', target: { sessionId: 'convection' } }];
  for (const scope of scopes) {
    const outcome = await f.read(scope);
    assert.equal(outcome.toolImages?.length, 1);
    assert.deepEqual(recentToolImage({ dataDir: f.dataDir, ...scope }, outcome.toolImages[0].id), outcome.toolImages[0]);
    assert.doesNotMatch(JSON.stringify(outcome), /base64|iVBOR|inlineImages/);
  }
});
