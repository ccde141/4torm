import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeNodeUserMessage } from './node-message-identity';

test('acknowledgement, optimistic row and SSE echo merge by stable ID in either order', () => {
  const message = { id: 'server-message-1', role: 'user' as const, content: '检查说明', timestamp: 'now' };
  for (const initial of [[], [message]]) {
    const once = mergeNodeUserMessage(initial, message);
    assert.equal(mergeNodeUserMessage(once, message).length, 1);
  }
});

test('equal text from different sends remains distinct and an echoed snapshot message is not duplicated', () => {
  const message = { id: 'first', role: 'user' as const, content: '继续', timestamp: 'now' };
  const second = { ...message, id: 'second' };
  assert.equal(mergeNodeUserMessage([message], second).length, 2);
  assert.equal(mergeNodeUserMessage([message], message).length, 1);
});
