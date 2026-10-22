import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { runNativeSubAgent, type NativeSubAgentEvent, type NativeSubAgentParams } from './native-sub-agent-runner.js';

async function fixture(t: test.TestContext, doneArgs?: unknown) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-subagent-failure-'));
  let calls = 0;
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* consume the local model request */ }
    calls++;
    if (doneArgs === undefined) {
      response.writeHead(402, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'fixture balance exhausted' } }));
      return;
    }
    const payload = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'done', type: 'function',
      function: { name: 'done', arguments: JSON.stringify(doneArgs) } }] }, finish_reason: 'tool_calls' }] };
    response.writeHead(200, { 'content-type': 'text/event-stream' })
      .end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'local', baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['fixture'],
  }] }));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const events: NativeSubAgentEvent[] = [];
  const params: NativeSubAgentParams = {
    agent: { id: 'agent', name: 'agent', model: 'local:fixture', rolePrompt: '', temperature: 0,
      tools: [], skills: [], workspace: '', sandboxLevel: 'project', toolMode: 'selected' },
    model: 'local:fixture', tools: [{ name: 'done', description: 'Finish', parameters: {
      type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'],
    } }], systemPrompt: '', task: 'test', context: '', dataDir, sandboxSection: '', escalationNote: '',
    constraintsSection: '', maxRounds: 1, signal: new AbortController().signal,
    emitEvent: event => events.push(event), parentSandboxLevel: 'project',
  };
  return { params, events, calls: () => calls };
}

test('原生 SubAgent 保留 provider 失败并且不执行额外提醒请求', async t => {
  const f = await fixture(t);
  const result = await runNativeSubAgent(f.params);
  assert.equal(f.calls(), 1);
  assert.equal(result.status, 'error');
  assert.match(result.error ?? '', /HTTP 402/);
  assert.deepEqual(f.events.at(-1), { type: 'done', data: result });
});

for (const summary of [undefined, '', '   ', 1, { text: 'not a summary' }]) {
  test(`原生 SubAgent 拒绝无效 done summary: ${JSON.stringify(summary)}`, async t => {
    const f = await fixture(t, summary === undefined ? {} : { summary });
    const result = await runNativeSubAgent(f.params);
    assert.equal(f.calls(), 1);
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'done requires a non-empty summary.');
  });
}

test('原生 SubAgent 有效 done 保留完整总结并只结束一次', async t => {
  const f = await fixture(t, { summary: 'valid summary' });
  const result = await runNativeSubAgent(f.params);
  assert.equal(f.calls(), 1);
  assert.equal(result.status, 'success');
  assert.equal(result.summary, 'valid summary');
  assert.equal(f.events.filter(event => event.type === 'done').length, 1);
});
