import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { SUB_AGENT_MAX_DURATION_MS, withSubAgentDeadline } from './sub-agent-deadline.js';
import type { SubAgentEvent, SubAgentResult } from './sub-agent-types.js';

for (const requested of [undefined, SUB_AGENT_MAX_DURATION_MS * 2]) {
  test(`SubAgent total deadline is capped at two hours: ${requested ?? 'default'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const parent = new AbortController();
    const events: SubAgentEvent[] = [];
    let signal!: AbortSignal;
    const pending = withSubAgentDeadline({ signal: parent.signal, timeout: requested,
      emit: event => events.push(event) }, async (bounded, emit) => {
      signal = bounded;
      emit({ type: 'tool_call', data: { tool: 'read_file', args: {} } });
      return new Promise<SubAgentResult>(() => {});
    });
    assert.equal(SUB_AGENT_MAX_DURATION_MS, 7_200_000);
    t.mock.timers.tick(SUB_AGENT_MAX_DURATION_MS - 1);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(signal.aborted, true);
    assert.equal(result.status, 'timeout');
    assert.equal(result.rounds, 1);
    assert.deepEqual(events.filter(event => event.type === 'done'), [{ type: 'done', data: result }]);
    assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  });
}

test('a shorter delegation deadline aborts work and discards late success and events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events: SubAgentEvent[] = [];
  let complete!: (result: SubAgentResult) => void;
  let lateEmit!: (event: SubAgentEvent) => void;
  const pending = withSubAgentDeadline({ signal: new AbortController().signal,
    timeout: 50, emit: event => events.push(event) }, async (_signal, emit) => {
    lateEmit = emit;
    return new Promise<SubAgentResult>(resolve => { complete = resolve; });
  });
  t.mock.timers.tick(50);
  const result = await pending;
  assert.equal(result.status, 'timeout');
  const count = events.length;
  lateEmit({ type: 'token', data: { t: 'late response' } });
  lateEmit({ type: 'done', data: { status: 'success', summary: 'late success', rounds: 0 } });
  complete({ status: 'success', summary: 'late success', rounds: 0 });
  await Promise.resolve();
  assert.equal(events.length, count);
  assert.equal(events.at(-1)?.type, 'done');
});

test('human cancellation remains aborted and cannot later become a timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parent = new AbortController();
  const events: SubAgentEvent[] = [];
  let child!: AbortSignal;
  const pending = withSubAgentDeadline({ signal: parent.signal, timeout: 50,
    emit: event => events.push(event) }, async signal => {
    child = signal;
    return new Promise<SubAgentResult>(() => {});
  });
  parent.abort();
  assert.equal((await pending).status, 'aborted');
  assert.equal(child.aborted, true);
  t.mock.timers.tick(100);
  assert.equal(events.length, 1);
});

test('completed work emits one result and releases its timer and parent listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parent = new AbortController();
  const events: SubAgentEvent[] = [];
  const expected: SubAgentResult = { status: 'success', summary: 'done', rounds: 0 };
  let child!: AbortSignal;
  assert.deepEqual(await withSubAgentDeadline({ signal: parent.signal, emit: event => events.push(event) },
    async (signal, emit) => {
      child = signal;
      emit({ type: 'done', data: expected });
      return expected;
    }), expected);
  t.mock.timers.tick(SUB_AGENT_MAX_DURATION_MS);
  parent.abort();
  assert.equal(child.aborted, false);
  assert.deepEqual(events, [{ type: 'done', data: expected }]);
});

test('an already-cancelled delegation never starts model or tool preparation', async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  const result = await withSubAgentDeadline({ signal: controller.signal }, async () => {
    started = true;
    return { status: 'success', summary: '', rounds: 0 };
  });
  assert.equal(result.status, 'aborted');
  assert.equal(started, false);
});
