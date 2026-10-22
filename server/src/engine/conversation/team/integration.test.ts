import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { SessionTeams } from './registry.js';
import { TeamStore } from './store.js';
import { SessionRunner, type SessionRunnerOpts } from '../session-runner.js';

test('team tools use real member SessionRunner, preserve context and adopt a changed provider model', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-integration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }>; tools?: unknown[] }> = [];
  const errors: unknown[] = [];
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, 'Bearer fixture-team-only');
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const content = `result-${requests.length}`;
      const mainProbe = body.messages.some((message: { content: string }) => message.content === 'Read my team');
      const callTool = mainProbe && !body.messages.some((message: { role: string }) => message.role === 'tool');
      if (mainProbe) assert.ok(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'team_read'));
      const delta = callTool
        ? { tool_calls: [{ index: 0, id: 'read-team', type: 'function', function: { name: 'team_read', arguments: '{}' } }] }
        : { content };
      response.setHeader('content-type', 'text/event-stream');
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: callTool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(error); response.statusCode = 500; response.end('fixture failure'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(root, 'providers.json'), JSON.stringify({ providers: [{ id: 'test',
    baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['first', 'second'], providerType: 'openai-compatible',
    transport: 'openai-chat-completions', apiKey: 'fixture-team-only' }] }));
  const teams = new SessionTeams();
  t.after(() => teams.shutdown());
  const opts: SessionRunnerOpts = { dataDir: root, agentId: 'a', sessionId: 's', model: 'test:first',
    temperature: 0.2, toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project', native: true };
  const extension = await teams.extension(opts);
  const created = JSON.parse(await extension.call('team_create', { name: 'Inspector', mission: 'inspect',
    rolePrompt: 'Be precise', taskContext: 'Only inspect assigned data', constraints: 'No writes' }));
  await assert.rejects(extension.call('team_dispatch', { memberId: created.memberId, task: 'First assignment' }), /TEAM_INVALID_REQUEST_ID/);
  await extension.call('team_dispatch', { memberId: created.memberId, task: 'First assignment', requestId: 'first' });
  const first = JSON.parse(await extension.call('team_wait', {}));
  assert.equal(first.reports[0].outcome, 'completed');
  assert.equal(first.reports[0].content, 'result-1');
  assert.match(requests[0].messages[0].content, /工作队中的成员/);
  assert.doesNotMatch(requests[0].messages[0].content, /长期的一对一|memory_write|memory_list|### ask|### delegate/);
  const updated = await teams.extension({ ...opts, model: 'test:second' });
  await updated.call('team_dispatch', { memberId: created.memberId, task: 'Second assignment', requestId: 'second' });
  const second = JSON.parse(await updated.call('team_wait', {}));
  assert.equal(second.reports.length, 2);
  assert.equal(requests[1].model, 'second');
  assert.ok(requests[1].messages.some(message => message.content === 'result-1'));
  assert.equal(requests[1].messages.at(-1)?.content, 'Second assignment');
  assert.equal(requests[1].messages.filter(message => message.role === 'system').length, 1);
  assert.equal(requests[1].tools?.length ?? 0, 0);
  assert.deepEqual(errors, []);
  const saved = await new TeamStore(root, { agentId: 'a', sessionId: 's' }).read();
  assert.equal(saved.members[0].context.at(-1)?.content, 'result-2');
  await updated.call('team_ack', { reportIds: JSON.stringify(second.reports.map((report: { id: string }) => report.id)) });
  assert.equal(JSON.parse(await updated.call('team_read', {})).reports.length, 0);
  await updated.call('team_dismiss', { memberId: created.memberId });
  await assert.rejects(updated.call('team_dispatch', { memberId: created.memberId, task: 'revive', requestId: 'third' }), /TEAM_MEMBER_DISMISSED/);
  const main = new SessionRunner({ ...opts, extension: updated });
  const results: string[] = [];
  await main.chat('test', [{ role: 'system', content: 'test' }, { role: 'user', content: 'Read my team' }], event => {
    if (event.type === 'tool-result' && event.tool === 'team_read') {
      assert.equal(event.ok, true);
      results.push(event.result);
    }
  });
  assert.equal(JSON.parse(results[0]).members[0].lifecycle, 'dismissed');
  assert.deepEqual(errors, []);
  const started = JSON.parse(await updated.call('team_start', {
    name: 'Verifier', task: 'First one-off task', requestId: 'one-off',
  }));
  await updated.call('team_wait', {});
  await updated.call('team_dispatch', {
    memberId: started.memberId, task: 'Second distinct task', requestId: 'follow-up',
  });
  await updated.call('team_wait', {});
  const laterSystem = requests.at(-1)?.messages.find(message => message.role === 'system')?.content ?? '';
  assert.match(laterSystem, /Mission: Verifier/);
  assert.doesNotMatch(laterSystem, /First one-off task/);
});

test('member execution rejects an aborted signal before making model requests', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-abort-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runner = new SessionRunner({ dataDir: root, agentId: 'a', model: 'absent:model', temperature: 0,
    toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project',
    native: true, memberTools: [], signal: AbortSignal.abort() });
  const result = await runner.chat('test', [{ role: 'user', content: 'work' }], () => {});
  assert.equal(result.content, '');
});
