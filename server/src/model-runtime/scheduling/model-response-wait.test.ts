import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelResponseWait, withModelResponseWait } from './model-response-wait.js';
import { validateProviderPatch } from '../config/provider-validation.js';

const MINUTE = 60_000;
test('response wait defaults to thirty minutes and supports independent model overrides', () => {
  assert.equal(resolveModelResponseWait(undefined, 'a'), 30 * MINUTE);
  assert.equal(resolveModelResponseWait({ a: 180 }, 'a'), 180 * MINUTE);
  assert.equal(resolveModelResponseWait({ a: 180 }, 'b'), 30 * MINUTE);
  const patch = { modelResponseWaitMinutes: { a: 180, b: 90 } };
  assert.deepEqual(validateProviderPatch(patch), patch);
  for (const minutes of [0, -1, 1.5, '30', null, Infinity]) {
    assert.throws(() => validateProviderPatch({ modelResponseWaitMinutes: { a: minutes } }));
    assert.throws(() => resolveModelResponseWait({ a: minutes }, 'a'));
  }
});

test('silent prefill is timed from request start and times out at the configured wait', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const operation = withModelResponseWait(undefined, 30 * MINUTE, signal => new Promise<void>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    t.mock.timers.tick(29 * MINUTE); assert.equal(signal.aborted, false);
    t.mock.timers.tick(MINUTE);
  }));
  await assert.rejects(operation, error => !!error && typeof error === 'object' && 'data' in error
    && (error.data as { code: string }).code === 'MODEL_RESPONSE_TIMEOUT');
});

test('real output renews the wait without a total execution deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  await withModelResponseWait(undefined, 30 * MINUTE, async (signal, touch) => {
    for (let phase = 0; phase < 20; phase++) {
      t.mock.timers.tick(29 * MINUTE); assert.equal(signal.aborted, false); touch();
    }
  });
  t.mock.timers.tick(180 * MINUTE);
});

test('parent cancellation and completion release the response clock', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const controller = new AbortController(); let child!: AbortSignal;
  await assert.rejects(withModelResponseWait(controller.signal, MINUTE, async signal => {
    child = signal; controller.abort(new Error('human stopped')); signal.throwIfAborted();
  }), /human stopped/);
  assert.equal(child.reason, controller.signal.reason);
  let completed!: AbortSignal;
  await withModelResponseWait(undefined, MINUTE, async signal => { completed = signal; });
  t.mock.timers.tick(180 * MINUTE); assert.equal(completed.aborted, false);
});
