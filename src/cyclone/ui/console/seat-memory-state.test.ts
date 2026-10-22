import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceSeatMemoryFeedback, resolveSavedSeatMemory } from './seat-memory-state';
import type { SeatMemoryDocument } from './workshop-console-model';

test('normalized new memory retains its returned identity for the next update', () => {
  const previous: SeatMemoryDocument = { revision: 0, entries: [] };
  const input = { title: ' Project note ', content: 'Keep this decision. \n\n' };
  const created: SeatMemoryDocument = { revision: 1,
    entries: [{ id: 'memory-1', title: input.title.trim(), content: input.content.trim(), updatedAt: '2026-10-17T12:00:00Z' }] };
  const saved = resolveSavedSeatMemory(previous, created);
  assert.equal(saved.id, 'memory-1');
  assert.notEqual(saved.content, input.content);
  const updated: SeatMemoryDocument = { revision: 2,
    entries: [{ ...saved, content: 'Keep the updated decision.', updatedAt: '2026-10-17T12:01:00Z' }] };
  const savedAgain = resolveSavedSeatMemory(created, updated, saved.id);
  assert.equal(savedAgain.id, saved.id);
  assert.equal(updated.entries.length, 1);
  assert.equal(savedAgain.content, 'Keep the updated decision.');
});

test('background read recovery keeps a failed save visible until explicitly acknowledged', () => {
  const failed = reduceSeatMemoryFeedback({ readError: '', saveError: '' }, { kind: 'save', error: 'revision conflict' });
  const readFailed = reduceSeatMemoryFeedback(failed, { kind: 'read', error: 'read offline' });
  const recovered = reduceSeatMemoryFeedback(readFailed, { kind: 'read', error: '' });
  assert.deepEqual(recovered, { readError: '', saveError: 'revision conflict' });
  assert.deepEqual(reduceSeatMemoryFeedback(recovered, { kind: 'reset' }), { readError: '', saveError: '' });
});
