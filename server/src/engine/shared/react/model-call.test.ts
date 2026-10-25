import assert from 'node:assert/strict';
import test from 'node:test';
import { callPreparedModel } from './model-call.js';

test('recovery can shrink several rejected requests inside the same task', async () => {
  let calls = 0;
  let recoveries = 0;
  const result = await callPreparedModel({
    call: async () => { if (++calls <= 3) throw new Error('rejected input'); return { content: 'complete', finishReason: 'stop' }; },
    recover: async () => { recoveries++; return true; },
  }, [{ role: 'user', content: 'fixture' }], undefined, {});
  assert.equal(result.content, 'complete');
  assert.equal(calls, 4); assert.equal(recoveries, 3);
});

test('recovery stops when the owner cannot reduce context or after output starts', async () => {
  for (const output of [false, true]) {
    let calls = 0; let recoveries = 0;
    await assert.rejects(callPreparedModel({ call: async (_messages, _options, onChunk) => {
      calls++; if (output) onChunk?.('partial'); throw new Error('failed');
    }, recover: async () => { recoveries++; return false; } }, [], undefined, { onChunk: () => {} }), /failed/);
    assert.equal(calls, 1); assert.equal(recoveries, output ? 0 : 1);
  }
});

test('owner cancellation stops model recovery immediately', async () => {
  const controller = new AbortController(); let recovered = false;
  await assert.rejects(callPreparedModel({ call: async () => { controller.abort(new Error('human stopped')); throw controller.signal.reason; },
    recover: async () => { recovered = true; return true; } }, [], controller.signal, {}), /human stopped/);
  assert.equal(recovered, false);
});
