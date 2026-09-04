import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileSelectedSeatIds } from './organization-selection';

test('reuses the current selection when React Flow reports the same seats again', () => {
  const current = ['seat-a', 'seat-b'];
  const next = reconcileSelectedSeatIds(current, [
    { id: 'seat-b', type: 'seat' },
    { id: 'group-a', type: 'group' },
    { id: 'seat-a', type: 'seat' },
  ]);

  assert.equal(next, current);
});

test('returns a new normalized selection only when selected seats change', () => {
  const current = ['seat-a'];
  const next = reconcileSelectedSeatIds(current, [
    { id: 'group-a', type: 'group' },
    { id: 'seat-b', type: 'seat' },
  ]);

  assert.deepEqual(next, ['seat-b']);
  assert.notEqual(next, current);
});
