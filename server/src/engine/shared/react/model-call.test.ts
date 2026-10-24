import assert from 'node:assert/strict';
import test from 'node:test';
import { callPreparedModel } from './model-call.js';
import { LLM_TIMEOUT_MS } from './native-loop.js';

test('preparation and recovery run outside each request timer, with a single safe retry', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const order: string[] = [];
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => {
    const id = originalSetTimeout(callback, milliseconds, ...args);
    if (milliseconds === LLM_TIMEOUT_MS) timers.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    timers.delete(id);
    return originalClearTimeout(id);
  }) as typeof clearTimeout;
  try {
    let calls = 0;
    const result = await callPreparedModel({
      prepare: async () => { assert.equal(timers.size, 0); order.push('prepare'); },
      call: async () => {
        assert.equal(timers.size, 1);
        order.push('call');
        if (++calls === 1) throw new Error('rejected input');
        return { content: 'complete', finishReason: 'stop' };
      },
      recover: async () => { assert.equal(timers.size, 0); order.push('recover'); return true; },
    }, [{ role: 'user', content: 'fixture' }], undefined, {});
    assert.equal(result.content, 'complete');
    assert.deepEqual(order, ['prepare', 'call', 'recover', 'call']);
    assert.equal(timers.size, 0);
    let attempts = 0;
    await assert.rejects(callPreparedModel({ call: async () => { attempts++; throw new Error('failure'); },
      recover: async () => true }, [], undefined, {}), /failure/);
    assert.equal(attempts, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    for (const id of timers) originalClearTimeout(id);
  }
});
