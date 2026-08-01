import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTargetId, targetIdFor } from './browser-protocol.js';

test('target ids bind an element index to its visible element signature', () => {
  const id = targetIdFor({ index: 2, role: 'a', name: 'Ccde141', href: 'https://example.test/u' });

  assert.match(id, /^target-2-[a-f0-9]{10}$/);
  assert.deepEqual(parseTargetId(id), { index: 2, digest: id.slice(-10) });
});

test('target ids reject arbitrary model-generated selectors', () => {
  assert.throws(() => parseTargetId('b18'), /targetId is invalid/);
  assert.throws(() => parseTargetId('target-1-bad'), /targetId is invalid/);
});
