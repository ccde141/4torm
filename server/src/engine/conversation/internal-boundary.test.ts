import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionRunner, type ConversationEvent } from './session-runner.js';
import type { ContextMessage } from '../shared/types.js';

for (const native of [true, false]) test(`internal correspondence waits for all tool results without skipping work (${native})`, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'internal-boundary-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'fixture',
    models: ['model'], baseUrl: 'http://127.0.0.1:9/v1' }] }));
  let pending = false; let included = false; let requests = 0;
  const executed: string[] = []; const events: ConversationEvent[] = [];
  const checkpoint: ContextMessage[][] = [];
  const inboxText = '[工作队内部消息 id=one，来源=主 Agent]\nUse a batch script';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); requests++;
    if (native && requests === 1) {
      const tools = ['first', 'second'].map((name, index) => ({ index, id: name, type: 'function',
        function: { name, arguments: '{}' } }));
      return sse({ tool_calls: tools }, 'tool_calls');
    }
    if (!native && requests <= 2) return sse({ content: JSON.stringify({ type: 'tool_call', name: requests === 1 ? 'first' : 'second', arguments: {} }) });
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.equal(executed.length, 2);
    assert.equal(messages.filter(message => message.content === inboxText).length, 1);
    if (native) {
      const internalIndex = messages.findIndex(message => message.content === inboxText);
      assert.equal(messages.slice(0, internalIndex).filter(message => message.role === 'tool').length, 2);
    }
    return sse({ content: 'Done after reading the update' });
  });
  const runner = new SessionRunner({ dataDir, agentId: 'a', model: 'fixture:model', native, temperature: 0,
    toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project',
    allowAsk: false, allowDelegate: false,
    extension: { definitions: ['first', 'second'].map(name => ({ name, description: name,
      parameters: { type: 'object', properties: {} } })),
    call: async name => { executed.push(name); if (name === 'second') assert.equal(included, false);
      if (name === 'first' && native || name === 'second') pending = true; return 'OK'; } },
    checkpoint: async context => { checkpoint.push(structuredClone(context)); },
    internalInbox: async context => ({ messages: pending && !context.some(message => message.content === inboxText) ? [inboxText] : [],
      commit: async () => { if (pending) { included = true; pending = false; } } }),
  });
  const result = await runner.chat('Rules', [{ role: 'user', content: 'Work' }], event => events.push(event));
  assert.match(result.content, /Done/);
  assert.deepEqual(executed, ['first', 'second']);
  assert.ok(checkpoint.some(context => context.some(message => message.content === inboxText)));
  assert.equal(events.some(event => event.type === 'input-received' || event.type === 'input-skipped'), false);
});

test('internal communication tools retain model results without publishing tool cards or argument progress', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'internal-silent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'fixture',
    models: ['model'], baseUrl: 'http://127.0.0.1:9/v1' }] }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++;
    if (calls === 1) return sse({ tool_calls: [{ index: 0, id: 'report', type: 'function',
      function: { name: 'team_report', arguments: '{"content":"Progress","messageId":"one"}' } }] }, 'tool_calls');
    assert.ok(JSON.parse(String(init.body)).messages.some((message: { role: string; content: string }) =>
      message.role === 'tool' && message.content === 'queued'));
    return sse({ content: 'Continue working' });
  });
  const events: ConversationEvent[] = [];
  const runner = new SessionRunner({ dataDir, agentId: 'a', model: 'fixture:model', native: true, temperature: 0,
    toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project', allowDelegate: false,
    extension: { definitions: [{ name: 'team_report', description: '', parameters: { type: 'object', properties: {} } }],
      silentTools: ['team_report'], call: async () => 'queued' } });
  await runner.chat('Rules', [{ role: 'user', content: 'Work' }], event => events.push(event));
  assert.equal(events.some(event => event.type === 'tool-call' || event.type === 'tool-result' || event.type === 'tool-progress'), false);
  assert.ok(events.some(event => event.type === 'token'));
});

function sse(delta: unknown, finish = 'stop') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } });
}
