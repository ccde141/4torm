import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionTeams } from './registry.js';
import { SessionRunner, type ConversationEvent, type SessionRunnerOpts } from '../session-runner.js';
import { TeamStore } from './store.js';

test('real parent and member exchange progress and corrections without extra UI events or restarting work', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-two-way-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'fixture',
    models: ['model'], baseUrl: 'http://127.0.0.1:9/v1' }] }));
  let memberCalls = 0; let mainCalls = 0;
  const memberContexts: Array<Array<{ role: string; content: string }>> = [];
  let reported!: () => void; let release!: () => void;
  const reportReady = new Promise<void>(resolve => { reported = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const teams = new SessionTeams();
  t.after(async () => { release(); await teams.shutdown(); });
  let memberId = ''; let runId = '';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const messages = body.messages as Array<{ role: string; content: string }>;
    if (messages[0].content.includes('工作队中的成员')) {
      memberContexts.push(messages);
      memberCalls++;
      if (memberCalls === 1) return tool('team_report', { content: 'Source needs a batch strategy', messageId: 'progress-one' });
      if (memberCalls === 2) { reported(); await gate; return text('First phase ready'); }
      return text('Batch data written');
    }
    mainCalls++;
    if (mainCalls === 1) {
      assert.ok(messages.some(message => message.content.includes('Source needs a batch strategy')));
      return tool('team_message', { memberId, runId, content: 'Please use batched requests', messageId: 'correction-one' });
    }
    return text('Main verified the work');
  });
  const options: SessionRunnerOpts = { dataDir, agentId: 'a', sessionId: 's', model: 'fixture:model',
    toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project', native: true,
    mainAgent: true, temperature: 0, allowAsk: false, allowDelegate: false };
  const extension = await teams.extension(options);
  const started = JSON.parse(await extension.call('team_start', { name: 'Collector', task: 'Collect data', requestId: 'task-one' }));
  memberId = started.memberId; runId = started.id;
  await reportReady;
  const events: ConversationEvent[] = [];
  const runner = new SessionRunner({ ...options, extension: { ...extension, call: async (name, args, signal) => {
    const result = await extension.call(name, args, signal);
    if (name === 'team_message') release();
    return result;
  } } });
  const result = await runner.chat('Main rules', [{ role: 'user', content: 'Continue and verify' }],
    event => events.push(event), 'main-run');
  assert.match(result.content, /Main verified/);
  const state = await new TeamStore(dataDir, { agentId: 'a', sessionId: 's' }).read();
  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].run?.id, runId);
  assert.equal(state.members[0].run?.status, 'completed', state.reports[0]?.content);
  assert.equal(state.reports.length, 1);
  assert.deepEqual(state.messages?.map(message => message.status), ['included', 'included']);
  assert.equal(memberCalls, 3);
  assert.equal(memberContexts[2].filter(message => message.content?.includes('工作队内部消息')
    && message.content.includes('Please use batched requests')).length, 1);
  assert.ok(mainCalls >= 2);
  assert.equal(events.some(event => (event.type === 'tool-call' || event.type === 'tool-result'
    || event.type === 'tool-progress') && event.tool === 'team_message'), false);
  assert.equal(events.some(event => event.type === 'input-received'), false);
  assert.ok(events.some(event => event.type === 'current-input'));
});

function text(content: string) { return response({ content }, 'stop'); }
function tool(name: string, args: unknown) { return response({ tool_calls: [{ index: 0,
  id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls'); }
function response(delta: unknown, finish_reason: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } });
}
