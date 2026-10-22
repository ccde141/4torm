import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackFromNodeEvent } from './node-feedback.js';

test('node feedback distinguishes completion, stop, and error', () => {
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n1', type: 'done', outcome: 'completed' }, 'n1'), 'completed');
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n1', type: 'done', outcome: 'stopped' }, 'n1'), 'stopped');
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n1', type: 'done', outcome: 'error' }, 'n1'), 'error');
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n1', type: 'error', message: 'failed' }, 'n1'), 'error');
});

test('legacy done events without an outcome do not claim success', () => {
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n1', type: 'done' }, 'n1'), null);
});

test('events without the current node id are ignored', () => {
  assert.equal(feedbackFromNodeEvent({ type: 'error', message: 'stream disconnected' }, 'n1'), null);
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n2', type: 'done', outcome: 'completed' }, 'n1'), null);
});

test('reused node IDs cannot consume another workflow execution feedback', () => {
  const identity = { workflowId: 'W1', executionId: 'R1' };
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n1', type: 'done', outcome: 'completed', workflowId: 'W2', executionId: 'R2' }, 'n1', identity), null);
  assert.equal(feedbackFromNodeEvent({ nodeId: 'n1', type: 'done', outcome: 'completed', ...identity }, 'n1', identity), 'completed');
});
