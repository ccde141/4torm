import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeDelegateTool,
  executeDelegateToolOutcome,
  type DelegateToolEvent,
} from './delegate-tool.js';
import { SUB_AGENT_MAX_ROUNDS } from '../shared/sub-agent-budget.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { buildSeatVirtualToolDefs } from '../cyclone/virtual-tools.js';
import { recentToolImage } from '../shared/tool-media-access.js';

test('委托截图进入即时事件和母会话结果，按原会话作用域登记且不包含base64', async () => {
  const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  const events: DelegateToolEvent[] = [];
  const outcome = await executeDelegateToolOutcome({ args: { task: 'inspect' }, dataDir: 'fixture',
    agentId: 'member', sessionId: 'delegate-media', model: 'fixture:model', sandboxLevel: 'project',
    signal: new AbortController().signal, emit: event => events.push(event) }, async params => {
      params.emit?.({ type: 'tool_result', data: { tool: 'mcp:fixture:observe', result: 'metadata', ok: true, toolImages } });
      return { status: 'success', summary: 'done', rounds: 1 };
    });
  assert.deepEqual(outcome.toolImages, toolImages);
  const event = events.find(item => item.type === 'delegate-tool-result');
  assert.ok(event?.type === 'delegate-tool-result');
  assert.deepEqual(event.toolImages, toolImages);
  assert.deepEqual(recentToolImage({ dataDir: 'fixture', feature: 'monsoon',
    target: { agentId: 'member', sessionId: 'delegate-media' } }, toolImages[0].id), toolImages[0]);
  assert.doesNotMatch(JSON.stringify({ events, outcome }), /base64|dataUrl/);
});

test('delegate outcome carries terminal success and failure without changing its events or string API', async () => {
  for (const status of ['success', 'error', 'timeout', 'aborted'] as const) {
    const events: DelegateToolEvent[] = [];
    const input = {
      args: { task: 'Review' }, dataDir: 'unused', agentId: 'agent-a',
      model: 'provider:model', sandboxLevel: 'project' as const,
      signal: new AbortController().signal,
      emit: (event: DelegateToolEvent) => events.push(event),
    };
    const run = async () => ({ status, summary: 'Report', rounds: 1 });
    const outcome = await executeDelegateToolOutcome(input, run);
    assert.deepEqual(outcome, { result: `[${status}] Report`, ok: status === 'success' });
    assert.deepEqual(events.map(event => event.type), ['delegate-start', 'delegate-done']);
    assert.equal(events[1].type === 'delegate-done' ? events[1].status : undefined, status);
    assert.equal(await executeDelegateTool(input, run), `[${status}] Report`);
  }
});

test('delegation exposes actionable framework errors and keeps provider bodies out of the report', async () => {
  for (const [error, expected] of [
    ['done requires a non-empty summary.', /done requires a non-empty summary/],
    ['HTTP 402 {"apiKey":"fixture-sensitive-value","private":"body"}', /HTTP 402/],
  ] as const) {
    const events: DelegateToolEvent[] = [];
    const result = await executeDelegateToolOutcome({ args: { task: 'verify' }, dataDir: 'unused',
      agentId: 'a', model: 'p:m', sandboxLevel: 'project', signal: new AbortController().signal,
      emit: event => events.push(event) }, async input => {
      assert.equal(input.maxRounds, SUB_AGENT_MAX_ROUNDS);
      return { status: 'error', summary: `[错误] ${error}`, rounds: 1, error };
    });
    assert.equal(result.ok, false);
    assert.match(result.result, expected);
    assert.doesNotMatch(JSON.stringify([events, result]), /fixture-sensitive-value|"private"/);
    const done = events.find(event => event.type === 'delegate-done');
    assert.ok(done?.type === 'delegate-done');
    assert.match(done.summary, expected);
  }
  for (const tools of [buildVirtualToolDefs(), buildSeatVirtualToolDefs()]) {
    assert.match(tools.find(tool => tool.name === 'delegate')!.description, new RegExp(String(SUB_AGENT_MAX_ROUNDS)));
  }
});
