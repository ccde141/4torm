import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAskRun, mayApplyAskSnapshot } from './ask-status';

test('only the current matching waiting run leaves a question answerable', () => {
  assert.equal(classifyAskRun('old', { runId: 'old', status: 'waiting' }), 'waiting');
  assert.equal(classifyAskRun('old', { runId: 'new', status: 'waiting' }), 'expired');
  assert.equal(classifyAskRun('old', { runId: 'old', status: 'crashed' }), 'expired');
  assert.equal(classifyAskRun('old', null), 'expired');
});

test('a matching run still finishing is not offered as an answerable card', () => {
  assert.equal(classifyAskRun('run', { runId: 'run', status: 'running' }), 'checking');
});

test('an older ask check cannot replace a newer reply or newer check', () => {
  const messages = [];
  const baseline = { sessionId: 'session-a', messages, sequence: 1 };
  assert.equal(mayApplyAskSnapshot(baseline, {
    sessionId: 'session-a', messages, sequence: 1, busy: false,
  }), true);
  assert.equal(mayApplyAskSnapshot(baseline, {
    sessionId: 'session-a', messages: [...messages], sequence: 1, busy: false,
  }), false);
  assert.equal(mayApplyAskSnapshot(baseline, {
    sessionId: 'session-a', messages, sequence: 2, busy: false,
  }), false);
  assert.equal(mayApplyAskSnapshot(baseline, {
    sessionId: 'session-a', messages, sequence: 1, busy: true,
  }), false);
  assert.equal(mayApplyAskSnapshot(baseline, {
    sessionId: 'session-b', messages, sequence: 1, busy: false,
  }), false);
});
