import assert from 'node:assert/strict';
import test from 'node:test';
import { frameworkError } from './framework-error.js';
import { providerHttpError, providerNetworkError } from './provider-request-error.js';
import { modelRetryAfter, withModelRequestRetry } from './model-request-retry.js';

const timeout = () => frameworkError({ code: 'MODEL_RESPONSE_TIMEOUT', kind: 'timeout',
  message: 'no response', source: 'fixture', retryable: false });

for (const failure of [providerNetworkError(new Error('offline')), timeout(), providerHttpError(429, ''),
  providerHttpError(503, ''), providerHttpError(529, '')]) {
  test(`${failure.data.code}: transient request can recover without restarting its owner`, async () => {
    let calls = 0;
    const result = await withModelRequestRetry({ delays: [0, 0], canRetry: () => true,
      run: async () => { if (++calls < 3) throw failure; return 'complete'; } });
    assert.equal(calls, 3); assert.equal(result, 'complete');
  });
}

test('persistent failure propagates the original error after the finite retry budget', async () => {
  const failure = providerHttpError(502, ''); let calls = 0;
  await assert.rejects(withModelRequestRetry({ delays: [0, 0], canRetry: () => true,
    run: async () => { calls++; throw failure; } }), error => error === failure);
  assert.equal(calls, 3);
});

test('partial output, human cancellation and permanent errors never replay a request', async () => {
  for (const failure of [providerHttpError(401, ''), providerHttpError(403, ''), providerHttpError(404, ''),
    providerHttpError(400, '{"error":{"code":"context_length_exceeded"}}'), new Error('invalid response')]) {
    let calls = 0;
    await assert.rejects(withModelRequestRetry({ delays: [0, 0], canRetry: () => true,
      run: async () => { calls++; throw failure; } }), error => error === failure);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(withModelRequestRetry({ delays: [0, 0], canRetry: () => false,
    run: async () => { calls++; throw timeout(); } }));
  assert.equal(calls, 1);
  const controller = new AbortController(); calls = 0;
  const operation = withModelRequestRetry({ signal: controller.signal, canRetry: () => true,
    run: async () => { calls++; queueMicrotask(() => controller.abort(new Error('human stopped'))); throw timeout(); } });
  await assert.rejects(operation); assert.equal(calls, 1);
});

test('Retry-After controls the backoff and cancellation can interrupt that wait', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let waiting!: () => void; const failed = new Promise<void>(resolve => { waiting = resolve; });
  const failure = providerHttpError(429, ''); failure.data.details = { retryAfterMs: 5_000 };
  let calls = 0;
  const operation = withModelRequestRetry({ delays: [0], canRetry: () => true,
    run: async () => { if (++calls === 1) { waiting(); throw failure; } return 'complete'; } });
  await failed; await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(4_999); assert.equal(calls, 1);
  t.mock.timers.tick(1); assert.equal(await operation, 'complete'); assert.equal(calls, 2);
  assert.equal(modelRetryAfter('2'), 2_000);
  assert.equal(modelRetryAfter('Sun, 25 Oct 2026 00:00:10 GMT', Date.UTC(2026, 9, 25)), 10_000);
  assert.equal(modelRetryAfter('invalid'), undefined); assert.equal(modelRetryAfter(null), undefined);
  const controller = new AbortController(); calls = 0;
  const cancelled = withModelRequestRetry({ signal: controller.signal, delays: [5_000], canRetry: () => true,
    run: async () => { calls++; throw failure; } });
  const checked = assert.rejects(cancelled);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(1_000); controller.abort(); await checked;
  t.mock.timers.tick(10_000); assert.equal(calls, 1);
});
