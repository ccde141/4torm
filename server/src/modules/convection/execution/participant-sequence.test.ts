import assert from 'node:assert/strict';
import test from 'node:test';
import { runParticipantSequence } from './participant-sequence.js';

test('one participant failure is reported and later participants still run', async () => {
  const executed: string[] = [];
  const committed: string[] = [];
  const failed: string[] = [];

  await runParticipantSequence({
    participantIds: ['a', 'broken', 'c'],
    execute: async id => {
      executed.push(id);
      if (id === 'broken') throw new Error('provider disconnected');
      return id.toUpperCase();
    },
    commit: async (id, result) => { committed.push(`${id}:${result}`); },
    reportFailure: async id => { failed.push(id); },
  });

  assert.deepEqual(executed, ['a', 'broken', 'c']);
  assert.deepEqual(committed, ['a:A', 'c:C']);
  assert.deepEqual(failed, ['broken']);
});

test('persistence failure remains fatal instead of being treated as a model failure', async () => {
  await assert.rejects(() => runParticipantSequence({
    participantIds: ['a', 'b'],
    execute: async id => id,
    commit: async () => { throw new Error('disk full'); },
    reportFailure: async () => {},
  }), /disk full/);
});

test('abort stops the sequence without reporting a provider failure', async () => {
  const controller = new AbortController();
  const failed: string[] = [];
  await runParticipantSequence({
    participantIds: ['a', 'b'],
    signal: controller.signal,
    execute: async id => { controller.abort(); throw new Error(`aborted ${id}`); },
    commit: async () => {},
    reportFailure: async id => { failed.push(id); },
  });
  assert.deepEqual(failed, []);
});
