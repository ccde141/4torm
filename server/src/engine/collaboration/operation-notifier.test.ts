import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationNotifier } from './operation-notifier.js';

test('运行通知按 operationId 与 runId 隔离且退订幂等', () => {
  const notifier = new OperationNotifier();
  let first = 0;
  let other = 0;
  const unsubscribe = notifier.subscribe(
    { operationId: 'task-a', runId: 'run-a' }, () => { first += 1; },
  );
  notifier.subscribe(
    { operationId: 'task-a', runId: 'run-b' }, () => { other += 1; },
  );
  notifier.publish({ operationId: 'task-a', runId: 'run-a' });
  unsubscribe();
  unsubscribe();
  notifier.publish({ operationId: 'task-a', runId: 'run-a' });
  assert.equal(first, 1);
  assert.equal(other, 0);
});
