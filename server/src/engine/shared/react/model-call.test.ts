import assert from 'node:assert/strict';
import test from 'node:test';
import { callPreparedModel } from './model-call.js';
import { providerHttpError } from '../provider-request-error.js';
import type { ContextMessage } from '../types.js';

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

test('explicit context exhaustion retains streamed text for compaction and continues the same request boundary', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'finish original task' }];
  let calls = 0;
  const result = await callPreparedModel({ call: async (_messages, _options, onChunk) => {
    if (++calls === 1) { onChunk?.('verified partial result');
      throw providerHttpError(400, '{"error":{"code":"context_window_exceeded"}}'); }
    return { content: 'continued', finishReason: 'stop' };
  }, recover: async (_error, current) => {
    assert.deepEqual(current.at(-1), { role: 'assistant', content: 'verified partial result' }); return true;
  } }, messages, undefined, { onChunk: () => {} });
  assert.equal(result.content, 'continued'); assert.equal(calls, 2);
  assert.equal(messages.filter(message => message.content === 'verified partial result').length, 1);
});

test('unsuccessful context recovery leaves canonical history untouched and never invents a completed tool', async () => {
  for (const fail of [false, true]) {
    const messages: ContextMessage[] = [{ role: 'user', content: 'original' }];
    const original = structuredClone(messages);
    await assert.rejects(callPreparedModel({ call: async (_messages, _options, onChunk) => {
      onChunk?.('partial'); throw providerHttpError(400, '{"error":{"code":"context_window_exceeded"}}');
    }, recover: async () => { if (fail) throw new Error('summary failed'); return false; } }, messages,
    undefined, { onChunk: () => {} }));
    assert.deepEqual(messages, original);
  }
});
