import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderScheduler } from './provider-scheduler.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('serializes one provider in FIFO order at its configured limit', async () => {
  const scheduler = new ProviderScheduler();
  const firstGate = deferred<void>();
  const events: string[] = [];

  const first = scheduler.run('local-llama', 1, async () => {
    events.push('first:start');
    await firstGate.promise;
    events.push('first:end');
  });
  const second = scheduler.run('local-llama', 1, async () => {
    events.push('second:start');
  });

  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('does not share capacity between provider instances', async () => {
  const scheduler = new ProviderScheduler();
  const firstGate = deferred<void>();
  const events: string[] = [];

  const first = scheduler.run('provider-a', 1, async () => {
    events.push('a:start');
    await firstGate.promise;
  });
  const second = scheduler.run('provider-b', 1, async () => {
    events.push('b:start');
  });

  await second;
  assert.deepEqual(events, ['a:start', 'b:start']);
  firstGate.resolve();
  await first;
});

test('removes an aborted waiter without consuming a later slot', async () => {
  const scheduler = new ProviderScheduler();
  const firstGate = deferred<void>();
  const controller = new AbortController();
  const events: string[] = [];

  const first = scheduler.run('provider', 1, async () => {
    await firstGate.promise;
  });
  const aborted = scheduler.run('provider', 1, async () => {
    events.push('aborted:started');
  }, controller.signal);
  const third = scheduler.run('provider', 1, async () => {
    events.push('third:started');
  });

  controller.abort(new Error('cancel queued request'));
  await assert.rejects(aborted, /cancel queued request/);
  firstGate.resolve();
  await Promise.all([first, third]);
  assert.deepEqual(events, ['third:started']);
});

test('releases capacity when an operation throws', async () => {
  const scheduler = new ProviderScheduler();
  const events: string[] = [];

  const failed = scheduler.run('provider', 1, async () => {
    events.push('failed:start');
    throw new Error('provider failed');
  });
  const next = scheduler.run('provider', 1, async () => {
    events.push('next:start');
  });

  await assert.rejects(failed, /provider failed/);
  await next;
  assert.deepEqual(events, ['failed:start', 'next:start']);
});
