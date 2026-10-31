import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../types';
import { ChatMessageCache } from './chat-message-cache';

const message = (content = 'saved'): ChatMessage[] => [{
  id: 'message', role: 'assistant', content, timestamp: '2026-01-01T00:00:00.000Z',
}];

test('reading a cached conversation keeps it while an older unused snapshot is evicted', () => {
  const cache = new ChatMessageCache({ maxEntries: 2 });
  cache.set('a', message()); cache.set('b', message());
  assert.ok(cache.get('a'));
  cache.set('c', message());
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
});

test('the byte allowance evicts histories before the count allowance is reached', () => {
  const cache = new ChatMessageCache({ maxEntries: 10, maxBytes: 1_400 });
  cache.set('a', message('a'.repeat(400)));
  cache.set('b', message('b'.repeat(400)));
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b')?.[0].content, 'b'.repeat(400));
});

test('oversized replacement is not cloned or retained and cannot expose the previous history', t => {
  const cache = new ChatMessageCache({ maxEntryBytes: 1_000 });
  cache.set('a', message());
  const clone = t.mock.method(globalThis, 'structuredClone');
  const source = message('long'.repeat(1_000));
  cache.set('a', source);
  assert.equal(cache.get('a'), undefined);
  assert.equal(clone.mock.callCount(), 0);
  assert.equal(source[0].content.length, 4_000);
});

test('cached snapshots are isolated from both the saved payload and readers', () => {
  const cache = new ChatMessageCache();
  const source = message();
  cache.set('a', source);
  source[0].content = 'changed by caller';
  const first = cache.get('a')!;
  assert.equal(first[0].content, 'saved');
  first[0].content = 'changed by reader';
  assert.equal(cache.get('a')?.[0].content, 'saved');
});

test('empty history and deletion release the prior cached snapshot', () => {
  const cache = new ChatMessageCache({ maxEntries: 1 });
  cache.set('a', message());
  cache.set('a', []);
  assert.equal(cache.get('a'), undefined);
  cache.set('b', message()); cache.delete('b');
  cache.set('c', message());
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('c'));
});
