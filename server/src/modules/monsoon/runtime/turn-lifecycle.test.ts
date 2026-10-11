import assert from 'node:assert/strict';
import test from 'node:test';
import { MonsoonSessionRegistry, type MonsoonRunnerHandle } from './session-registry.js';

function fakeRunner(): MonsoonRunnerHandle {
  return {
    isBusy: () => false, isSuspended: () => true, getAgentId: () => 'agent-a',
    getModel: () => 'model-a', getInputRuntime: () => null, abort: () => {},
  };
}

test('a new turn reserves its session and lease, then releases both', () => {
  let released = 0;
  const registry = new MonsoonSessionRegistry(() => () => { released++; });
  const first = registry.reserve('session-a', 'agent-a', fakeRunner);
  assert.ok(first);
  assert.equal(registry.reserve('session-a', 'agent-a', fakeRunner), null);
  registry.clear('session-a', first);
  const second = registry.reserve('session-a', 'agent-a', fakeRunner);
  assert.ok(second);
  assert.notEqual(second, first);
  registry.clear('session-a', first);
  assert.equal(registry.get('session-a'), second);
  registry.clear('session-a', second);
  assert.equal(released, 2);
});

test('resume accepts exactly one claimant for a suspended turn', () => {
  const registry = new MonsoonSessionRegistry(() => () => {});
  const runner = registry.reserve('session-a', 'agent-a', fakeRunner)!;
  assert.equal(registry.claimResume('session-a', runner), false);
  registry.markWaiting('session-a', runner);
  assert.equal(registry.claimResume('session-a', runner), true);
  assert.equal(registry.claimResume('session-a', runner), false);
});

test('failed construction and shutdown each release their lease once', () => {
  let released = 0;
  let aborted = 0;
  const registry = new MonsoonSessionRegistry(() => () => { released++; });
  assert.throws(() => registry.reserve('s', 'a', () => { throw new Error('construction'); }), /construction/);
  assert.equal(registry.get('s'), undefined);
  const runner = registry.reserve('s', 'a', () => ({ ...fakeRunner(), abort: () => { aborted++; } }))!;
  registry.shutdown();
  registry.shutdown();
  assert.equal(registry.get('s'), undefined);
  assert.equal(released, 2);
  assert.equal(aborted, 1);
  registry.clear('s', runner);
  assert.equal(released, 2);
});

test('probe snapshot follows real running and waiting transitions', () => {
  const registry = new MonsoonSessionRegistry(() => () => {});
  const running = registry.reserve('run', 'agent-a', fakeRunner)!;
  const waiting = registry.reserve('wait', 'agent-a', fakeRunner)!;
  registry.markRunning('run', running);
  registry.markWaiting('wait', waiting);
  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot.items.map(item => [item.operationId, item.status]), [
    ['run', 'running'], ['wait', 'waiting'],
  ]);
  registry.clear('run', running);
  assert.notEqual(registry.snapshot().revision, snapshot.revision);
});
