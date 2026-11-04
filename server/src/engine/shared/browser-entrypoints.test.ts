import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { browserRuntime, type BrowserRuntimeInput } from '../../services/browser-runtime.js';
import { SessionRunner, type SessionRunnerOpts } from '../conversation/session-runner.js';
import { memberExecutor } from '../conversation/team/executor.js';
import { loadAgent } from './agent-loader.js';
import { loadAgentToolDefs } from './tool-defs-loader.js';
import { runNativeSubAgent } from './native-sub-agent-runner.js';
import { runTextSubAgent } from './text-sub-agent-executor.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-entrypoints-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'skills'), { recursive: true });
  await fs.cp(new URL('../../../../data/skills/browser/', import.meta.url), path.join(dataDir, 'skills/browser'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents/registry.json'), JSON.stringify({ a: { id: 'a', name: 'A',
    model: 'p:model', config: { skills: ['browser'], tools: [], toolMode: 'selected' } } }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://isolated.invalid/v1', models: ['model'] }] }));
  const executions: BrowserRuntimeInput[] = [];
  t.mock.method(browserRuntime, 'execute', async (input: BrowserRuntimeInput) => { executions.push(input); return 'fixture-browser-result'; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const finished = body.messages.some((message: { role: string; content: unknown }) =>
      message.role === 'tool' || typeof message.content === 'string' && message.content.startsWith('{"type":"tool_result"'));
    const native = !!body.tools?.length;
    const done = finished && body.tools?.some((tool: { function: { name: string } }) => tool.function.name === 'done');
    const name = done ? 'done' : 'browser';
    const args = done ? { summary: 'done' } : { action: 'inspect' };
    const delta = native && (!finished || done) ? { tool_calls: [{ index: 0, id: `call-${name}`, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] }
      : { content: native ? 'done' : JSON.stringify({ type: 'tool_call', name: finished ? 'done' : 'browser',
        arguments: finished ? { summary: 'done' } : { action: 'inspect' } }) };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: native && (!finished || done) ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const options: SessionRunnerOpts = { dataDir, agentId: 'a', model: 'p:model', temperature: 0,
    toolNames: [], toolMode: 'selected', skillIds: ['browser'], workspace: 'data/agents/a/.workspace',
    sandboxLevel: 'project', native: true, allowAsk: false, allowDelegate: false };
  return { dataDir, executions, options };
}

test('SessionRunner forwards an explicit execution owner without a human session or HTTP tool bridge', async t => {
  const { executions, options } = await fixture(t);
  for (const ownerId of ['tide:a:task-session', 'team:human-session:member-1']) {
    const runner = new SessionRunner({ ...options, executionOwner: { scope: 'conversation', ownerId } });
    await runner.chat('fixture', [{ role: 'user', content: 'inspect browser' }], () => {});
    assert.equal(executions.at(-1)?.ownerId, ownerId);
  }
  assert.equal(executions.length, 2);
});

test('real team members keep separate browser ownership from their parent and each other', async t => {
  const { executions, options } = await fixture(t);
  const execute = memberExecutor({ ...options, sessionId: 'human-session' });
  for (const id of ['member-1', 'member-2']) await execute({ id, name: id, mission: 'inspect', rolePrompt: '',
    taskContext: '', constraints: '', lifecycle: 'active', context: [],
    permissions: { tools: [], skills: ['browser'], sandboxLevel: 'project' } }, 'inspect', async () => {},
    new AbortController().signal, { observe: () => {}, report: async () => ({ messageId: 'fixture', status: 'queued' }),
      inbox: async () => ({ messages: [], commit: async () => {} }) });
  assert.deepEqual(executions.map(input => input.ownerId), ['team:human-session:member-1', 'team:human-session:member-2']);
});

test('native and text delegates reach the browser capability with independent owners', async t => {
  const { executions, dataDir } = await fixture(t);
  const agent = (await loadAgent(dataDir, 'a'))!;
  const tools = [...await loadAgentToolDefs(dataDir, [], ['browser'], 'selected'), {
    name: 'done', description: 'done', parameters: { type: 'object', properties: { summary: { type: 'string' } } } }];
  const params = { dataDir, agent, model: 'p:model', tools, systemPrompt: 'fixture', task: 'inspect', context: '',
    sandboxSection: '', escalationNote: '', constraintsSection: '', maxRounds: 8,
    signal: new AbortController().signal, emitEvent: () => {}, parentSandboxLevel: 'project' as const };
  assert.equal((await runNativeSubAgent(params)).status, 'success');
  assert.equal((await runTextSubAgent(params)).status, 'success');
  assert.equal(executions.length, 2);
  assert.notEqual(executions[0].ownerId, executions[1].ownerId);
  assert.ok(executions.every(input => input.ownerId.startsWith('delegate:')));
});
