import test from 'node:test';
import assert from 'node:assert/strict';
import { toRoomProgressEvent, toSeatProgressEvent } from './loop-event-forwarder';

test('seat progress forwards heartbeat with elapsed time', () => {
  assert.deepEqual(
    toSeatProgressEvent({ type: 'heartbeat', phase: 'tool-exec', elapsed: 65_000 }),
    { type: 'heartbeat', phase: 'tool-exec', elapsed: 65_000 },
  );
});

test('seat failure is forwarded while the room consumes its terminal result after persistence', () => {
  const error = { type: 'error' as const, message: 'provider unavailable' };
  assert.deepEqual(toSeatProgressEvent(error), error);
  assert.equal(toRoomProgressEvent('研究工位', error), null);
});

test('room progress keeps speaker ownership on heartbeat', () => {
  assert.deepEqual(
    toRoomProgressEvent('研究工位', { type: 'heartbeat', phase: 'llm-waiting', elapsed: 12_000 }),
    { type: 'heartbeat', speaker: '研究工位', phase: 'llm-waiting', elapsed: 12_000 },
  );
});

test('seat progress forwards tool preparation without argument content', () => {
  assert.deepEqual(
    toSeatProgressEvent({ type: 'tool-progress', stage: 'preparing', tool: 'write_file', argumentChars: 18_432, elapsed: 32_000 }),
    { type: 'tool-progress', stage: 'preparing', tool: 'write_file', argumentChars: 18_432, elapsed: 32_000 },
  );
});

test('per-call usage reaches seat and room streams, including unknown usage', () => {
  const usage = { promptTokens: 1_200, completionTokens: 30, totalTokens: 1_230 };
  assert.deepEqual(toSeatProgressEvent({ type: 'usage', usage }), { type: 'usage', usage });
  assert.deepEqual(toSeatProgressEvent({ type: 'usage', usage: null }), { type: 'usage', usage: null });
  assert.deepEqual(toRoomProgressEvent('研究工位', { type: 'usage', usage }), {
    type: 'usage', speaker: '研究工位', usage,
  });
});
