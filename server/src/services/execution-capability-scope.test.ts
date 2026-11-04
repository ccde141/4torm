import assert from 'node:assert/strict';
import test from 'node:test';
import { executionObserver } from './execution-observer.js';
import { browserExecutionProducer } from './browser-execution-producer.js';
import { closeExecutionCapabilityScope } from './execution-capability-scope.js';

test('temporary owner cleanup closes only that owner surfaces, preserving the parent browser', async t => {
  const parent = executionObserver.start({ scope: 'conversation', ownerId: 'parent', command: 'fixture', kind: 'browser', viewer: 'browser' });
  const child = executionObserver.start({ scope: 'conversation', ownerId: 'child', command: 'fixture', kind: 'browser', viewer: 'browser' });
  const closed: string[] = [];
  t.mock.method(browserExecutionProducer, 'close', async (id: string) => { closed.push(id); });
  await closeExecutionCapabilityScope({ scope: 'conversation', ownerId: 'child' });
  assert.deepEqual(closed, [child.id]);
  executionObserver.finish(parent.id, { status: 'completed' });
  executionObserver.finish(child.id, { status: 'completed' });
});
