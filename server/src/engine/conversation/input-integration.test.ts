import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { SessionRunner, type ConversationEvent } from './session-runner.js';
import { readInputJournal } from './input-journal.js';

test('real SessionRunner and HTTP model bridge consume steering before executing the stale tool plan', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-integration-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const holder: { runner?: SessionRunner } = {};
  let calls = 0;
  const events: ConversationEvent[] = [];
  const server = http.createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      let delta;
      if (++calls === 1) {
        await holder.runner!.getInputRuntime()!.submit({ id: 'change', content: 'Do not execute tools. Say revised.' });
        delta = { tool_calls: [{ index: 0, id: 'stale', type: 'function', function: { name: 'read_file', arguments: '{"path":"no-access"}' } }] };
      } else {
        assert.equal(body.messages.at(-1).role, 'user');
        assert.equal(body.messages.at(-1).content, 'Do not execute tools. Say revised.');
        assert.ok(body.messages.some((message: { role: string; tool_call_id?: string }) => message.role === 'tool' && message.tool_call_id === 'stale'));
        delta = { content: 'revised' };
      }
      response.setHeader('content-type', 'text/event-stream');
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { response.statusCode = 500; response.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'test',
    baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['model'], providerType: 'openai-compatible',
    transport: 'openai-chat-completions', apiKey: 'fixture-only', }] }));
  const runner = new SessionRunner({ dataDir, agentId: 'agent-test', sessionId: 'session-test', model: 'test:model',
    temperature: 0.5, toolNames: ['read_file'], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project', native: true,
    interceptTool: () => { throw new Error('Stale tool must not execute'); } });
  holder.runner = runner;
  const result = await runner.chat('test', [{ role: 'system', content: 'test' }, { role: 'user', content: 'initial' }],
    event => events.push(event), 'run-test');
  assert.equal(result.content, 'revised');
  assert.equal(calls, 2);
  assert.equal(events.some(event => event.type === 'tool-call'), false);
  assert.equal(events.at(-1)?.type, 'done');
  const checkpoint = (await readInputJournal(dataDir, { agentId: 'agent-test', sessionId: 'session-test', runId: 'run-test' })).checkpoint!;
  assert.deepEqual(checkpoint.includedIds, ['change']);
  assert.equal(checkpoint.context.at(-1)?.content, 'revised');
  assert.equal(checkpoint.closed, true);
  assert.equal(runner.isBusy(), false);
  await assert.rejects(runner.chat('test', [], () => {}, 'run-test'), /INPUT_RUN_REUSED/);
  assert.equal(calls, 2);
});
