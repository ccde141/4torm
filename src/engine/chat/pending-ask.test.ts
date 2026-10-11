import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { decidePendingAskInputRoute, findLatestAnswerableAsk } from './pending-ask';

function assistant(id: string, inputRunId?: string): ChatMessage {
  return { id, inputRunId, role: 'assistant', content: '', timestamp: 'now' };
}

function ask(id: string, answered = false, sourceRunId?: string): ChatMessage {
  return { id, role: 'assistant', content: '', timestamp: 'now',
    ask: { question: `${id}?`, answered, sourceRunId } };
}

test('new ask carries the waiting run ID directly', () => {
  const question = ask('ask-a', false, 'run-a');
  assert.equal(Object.hasOwn(question, 'inputRunId'), false);
  assert.deepEqual(findLatestAnswerableAsk([question]), { id: 'ask-a', runId: 'run-a' });
});

test('legacy ask uses the preceding assistant run ID', () => {
  assert.deepEqual(findLatestAnswerableAsk([
    assistant('run-a', 'run-a'), ask('ask-a'),
  ]), { id: 'ask-a', runId: 'run-a' });
});

test('only the latest ask can be answered', () => {
  const previous = [assistant('run-a', 'run-a'), ask('ask-a')];
  assert.deepEqual(findLatestAnswerableAsk([
    ...previous, assistant('run-b', 'run-b'), ask('ask-b', false, 'run-b'),
  ]), { id: 'ask-b', runId: 'run-b' });
  assert.equal(findLatestAnswerableAsk([
    ...previous, assistant('run-b', 'run-b'), ask('ask-b', true, 'run-b'),
  ]), undefined);
});

test('an ask without a known run cannot bind to an earlier ask run', () => {
  assert.equal(findLatestAnswerableAsk([
    assistant('run-a', 'run-a'), ask('ask-a'),
    assistant('intervening'), ask('ask-b'),
  ]), undefined);
  assert.equal(findLatestAnswerableAsk([ask('ask-a')]), undefined);
});

test('an ask blocks composer input until the old stream has finished', () => {
  const target = { id: 'ask-b', runId: 'run-b' };
  assert.equal(decidePendingAskInputRoute(target, { askId: 'ask-b', status: 'waiting' }, true), 'blocked');
  assert.equal(decidePendingAskInputRoute(target, { askId: 'ask-b', status: 'expired' }, true), 'blocked');
});

test('current ask feedback determines whether input answers or waits', () => {
  const target = { id: 'ask-b', runId: 'run-b' };
  for (const status of ['waiting', 'failed'] as const) {
    assert.equal(decidePendingAskInputRoute(target, { askId: target.id, status }, false), 'answer');
  }
  for (const status of ['checking', 'submitting', 'unknown', 'accepted'] as const) {
    assert.equal(decidePendingAskInputRoute(target, { askId: target.id, status }, false), 'blocked');
  }
  assert.equal(decidePendingAskInputRoute(target, { askId: target.id, status: 'expired' }, false), 'new');
  assert.equal(decidePendingAskInputRoute(target, null, false), 'blocked');
});

test('old ask feedback does not decide the route for a newer ask', () => {
  const target = { id: 'ask-b', runId: 'run-b' };
  assert.equal(decidePendingAskInputRoute(target, { askId: 'ask-a', status: 'waiting' }, false), 'blocked');
  assert.equal(decidePendingAskInputRoute(target, { askId: 'ask-a', status: 'expired' }, false), 'blocked');
});

test('without an answerable ask, input starts a turn or steers the active one', () => {
  assert.equal(decidePendingAskInputRoute(undefined, null, false), 'new');
  assert.equal(decidePendingAskInputRoute(undefined, null, true), 'steer');
});
