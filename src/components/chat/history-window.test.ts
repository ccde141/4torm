import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { historyWindow } from './history-window.js';

function message(index: number): ChatMessage {
  return { id: `message-${index}`, role: 'user', content: `text ${index}`,
    timestamp: '2026-01-01T00:00:00.000Z' };
}

test('large history initially shows recent messages and reveals older turns in batches', () => {
  const source = Array.from({ length: 80 }, (_, index) => message(index));
  const first = historyWindow(source, false, 24);
  assert.equal(first.hiddenCount, 56);
  assert.deepEqual(first.messages.map(item => item.id), source.slice(-24).map(item => item.id));
  const more = historyWindow(source, false, 48);
  assert.equal(more.hiddenCount, 32);
  assert.equal(more.messages[0]?.id, 'message-32');
  assert.equal(source.length, 80);
});

test('an unfinished latest turn remains visible while empty historical placeholders stay hidden', () => {
  const source = [message(0), { ...message(1), content: '' }, { ...message(2), content: '' }];
  const result = historyWindow(source, true, 1);
  assert.equal(result.hiddenCount, 1);
  assert.equal(result.messages[0]?.id, 'message-2');
});
