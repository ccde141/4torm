import assert from 'node:assert/strict';
import test from 'node:test';
import { nextActivityCursor } from './activity-page-cursor.js';

test('activity cursor follows the last delivered event instead of skipping a 300-event replay', () => {
  const first = { latestSeq: 300, events: Array.from({ length: 128 }, (_, index) => ({ seq: index + 1 })) };
  assert.equal(nextActivityCursor(first), 128);
  const second = { latestSeq: 300, events: Array.from({ length: 128 }, (_, index) => ({ seq: index + 129 })) };
  assert.equal(nextActivityCursor(second), 256);
  assert.equal(nextActivityCursor({ latestSeq: 300, events: [{ seq: 300 }] }), 300);
  assert.equal(nextActivityCursor({ latestSeq: 300, events: [] }), 300);
});
