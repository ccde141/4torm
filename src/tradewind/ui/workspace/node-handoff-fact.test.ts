import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeHandoffFact } from './node-handoff-fact';

test('arrival belongs to the active activation, not the latest transfer for the node', () => {
  const facts = [{ activationId: 'current', target: 'review', sentAt: '09:00', receivedAt: '09:01' },
    { activationId: 'next', target: 'review', sentAt: '09:02', receivedAt: '09:03' }];
  assert.equal(nodeHandoffFact(facts, 'review', 'current')?.receivedAt, '09:01');
  assert.equal(nodeHandoffFact(facts, 'review', 'unknown'), undefined);
  assert.equal(nodeHandoffFact(facts, 'other', 'current'), undefined);
});
