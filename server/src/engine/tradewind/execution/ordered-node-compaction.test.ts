import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NodeRunner, type NodeRunnerEvent } from './node-runner.js';

for (const native of [true, false]) test(`manual node summary retains its last request system and tool transport (${native ? 'native' : 'text'})`, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-ordered-summary-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://node-ordered.test/v1', models: ['model'], nativeMode: native ? 'native' : 'text',
  }] }));
  const requests: Array<{ messages: Array<{ role: string; content: string }>; tools?: unknown[]; tool_choice?: string }> = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    const summary = String(body.messages.at(-1).content).includes('交接记录');
    const content = summary ? 'Earlier node evidence is verified; continue current work.' : 'Verified answer '.repeat(100);
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })
      + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const runner = new NodeRunner({ dataDir, workflowId: 'workflow', executionId: 'run',
    nodeId: 'node', agentId: 'worker', model: 'p:model', temperature: 0, toolMode: 'selected',
    toolNames: [], skillIds: [], workspace: dataDir, sandboxLevel: 'project',
    systemPrompt: 'NODE-PROMPT-51: Verify original task evidence.', native,
    signal: new AbortController().signal, persistDir: path.join(dataDir, 'node') });
  let finish: (() => void) | undefined;
  const events: NodeRunnerEvent[] = [];
  runner.addEventListener(event => { events.push(event); if (event.type === 'done') finish?.(); });
  const send = (content: string) => new Promise<void>(resolve => {
    finish = resolve; runner.push({ source: 'human', content });
  });
  for (let index = 0; index < 5; index++) await send(`TASK-${index} `.repeat(100));
  const previous = requests.at(-1)!;
  assert.equal(requests.length, 5);
  await send('/compact');
  assert.equal(requests.length, 6);
  assert.ok(!events.some(event => event.type === 'error'));
  const summary = requests.at(-1)!;
  assert.deepEqual(summary.messages[0], previous.messages[0]);
  assert.deepEqual(summary.messages.map(message => message.role), ['system', 'user', 'assistant', 'user']);
  assert.ok(summary.messages[1].content.includes('TASK-0'));
  assert.ok(!summary.messages.some(message => /TASK-[1-4]/.test(message.content)));
  assert.match(summary.messages.at(-1)!.content, /交接记录/);
  assert.deepEqual(summary.tools, previous.tools);
  if (native) {
    assert.ok(summary.tools?.length);
    assert.equal(summary.tool_choice, 'none');
  } else assert.equal(summary.tools, undefined);
  assert.ok(events.some(event => event.type === 'compact-done'));
});
