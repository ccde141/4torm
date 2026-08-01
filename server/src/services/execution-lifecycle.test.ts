import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionLifecycle } from './execution-lifecycle.js';

test('execution lifecycle terminates only the registered owner once', async () => {
  const lifecycle = new ExecutionLifecycle();
  let stopped = 0;

  lifecycle.register({ id: 'run-a', scope: 'conversation', ownerId: 'owner-a' }, () => { stopped++; });

  assert.equal(await lifecycle.terminate('run-a', 'conversation', 'owner-b'), false);
  assert.equal(stopped, 0);
  assert.equal(await lifecycle.terminate('run-a', 'conversation', 'owner-a'), true);
  assert.equal(stopped, 1);
  assert.equal(await lifecycle.terminate('run-a', 'conversation', 'owner-a'), false);
  assert.equal(stopped, 1);
});

test('releasing a run cannot remove a newer lifecycle registration', async () => {
  const lifecycle = new ExecutionLifecycle();
  let first = 0;
  let second = 0;
  const releaseFirst = lifecycle.register({ id: 'run-a', scope: 'conversation', ownerId: 'owner-a' }, () => { first++; });
  lifecycle.register({ id: 'run-a', scope: 'conversation', ownerId: 'owner-a' }, () => { second++; });

  releaseFirst();

  assert.equal(await lifecycle.terminate('run-a', 'conversation', 'owner-a'), true);
  assert.equal(first, 0);
  assert.equal(second, 1);
});
