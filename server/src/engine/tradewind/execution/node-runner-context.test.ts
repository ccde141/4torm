import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NodeRunner, type NodeRunnerEvent, type QueuedMessage } from './node-runner.js';
import { clearContactRegistry, initContactRegistry, tryRegisterWait } from './contact-registry.js';

async function fixture(t: test.TestContext, native: boolean) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-context-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://fixture.invalid/v1', models: ['demo'],
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
  }] }));
  return new NodeRunner({ dataDir, workflowId: 'workflow', executionId: dataDir,
    nodeId: 'node', agentId: 'agent', model: 'fixture:demo', temperature: 0,
    toolNames: ['read_file'], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project',
    systemPrompt: '你当前的身份：Caller', native, allowDelegate: false, contactTargets: ['Peer'],
    persistDir: path.join(dataDir, 'node'), signal: new AbortController().signal });
}

function response(delta: unknown, finishReason = 'stop') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } });
}

async function turn(runner: NodeRunner, content: string) {
  await new Promise<void>((resolve, reject) => {
    const listener = (event: NodeRunnerEvent) => {
      if (event.type === 'error') { runner.removeEventListener(listener); reject(new Error(event.message)); }
      if (event.type === 'done') { runner.removeEventListener(listener); resolve(); }
    };
    runner.addEventListener(listener);
    runner.push({ source: 'human', content });
  });
  await runner.flush();
  while (runner.isBusy()) await new Promise<void>(resolve => setImmediate(resolve));
}

for (const native of [true, false]) test(`node retains exact tool evidence, media and concurrent facts across rounds (${native})`, async t => {
  const runner = await fixture(t, native);
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const requests: string[] = [];
  const image = { id: 'fixture-image', mimeType: 'image/png' };
  Object.assign(runner, { execTool: async () => {
    runner.appendSystemMessage('independent meeting fact');
    return { result: 'exact tool evidence', ok: true, toolImages: [image] };
  } });
  globalThis.fetch = async (_url, init) => {
    requests.push(String(init?.body));
    if (requests.length === 1) return native
      ? response({ tool_calls: [{ index: 0, id: 'read-one', type: 'function',
        function: { name: 'read_file', arguments: '{"filePath":"fixture.txt"}' } }] }, 'tool_calls')
      : response({ content: '{"type":"tool_call","name":"read_file","arguments":{"filePath":"fixture.txt"}}' });
    return response({ content: requests.length === 2 ? 'first answer' : 'second answer' });
  };
  await turn(runner, 'read then answer');
  await turn(runner, 'continue using that evidence');
  assert.match(requests[2], /exact tool evidence/);
  assert.match(requests[2], /independent meeting fact/);
  const messages = runner.getMessages();
  assert.equal(messages.filter(message => message.role === 'assistant' && message.content === 'first answer').length, 1);
  assert.equal(messages.filter(message => message.content.includes('independent meeting fact')).length, 1);
  assert.deepEqual(messages.flatMap(message => message.toolImages ?? []), [image]);
  const persisted = JSON.parse(await fs.readFile(path.join(runner.getDataDir(), 'node', 'messages.json'), 'utf8'));
  assert.deepEqual(persisted, messages);
  if (native) {
    const next = JSON.parse(requests[2]);
    assert.equal(next.messages.filter((message: { role: string }) => message.role === 'tool').length, 1);
  }
});

test('stopping a human round releases a pending contact without waiting for the peer', async t => {
  const runner = await fixture(t, true);
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; clearContactRegistry(runner.getIdentity().executionId); });
  let accepted!: () => void;
  const peerAccepted = new Promise<void>(resolve => { accepted = resolve; });
  let peerMessage: QueuedMessage | undefined;
  const peer = { push(message: QueuedMessage) { peerMessage = message; accepted(); } };
  initContactRegistry({ peer: 'Peer' }, { get: () => peer as unknown as NodeRunner }, runner.getIdentity().executionId);
  globalThis.fetch = async () => response({ tool_calls: [{ index: 0, id: 'contact', type: 'function',
    function: { name: 'contact', arguments: '{"target":"Peer","message":"hello"}' } }] }, 'tool_calls');
  const done = new Promise<void>(resolve => runner.addEventListener(event => { if (event.type === 'done') resolve(); }));
  runner.push({ source: 'human', content: 'Ask the peer' });
  await peerAccepted;
  assert.equal(runner.abortRound(runner.getRoundIdentity()!.runId), true);
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('contact was not cancelled')), 1000).unref())]);
  assert.equal(runner.isBusy(), false);
  assert.equal(tryRegisterWait('peer', 'node', runner.getIdentity().executionId), true);
  peerMessage!.onComplete?.('late peer answer');
  await runner.flush();
  assert.equal(runner.getMessages().some(message => message.content.includes('late peer answer')), false);
});
