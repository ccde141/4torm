import assert from 'node:assert/strict';
import test from 'node:test';
import { placeFrameworkReferences } from './reference-placement.js';
import type { ContextMessage } from '../types.js';

test('references precede their human input without changing canonical history, earlier turns or tool pairs', () => {
  const history: ContextMessage[] = [{ role: 'system', content: 'stable' }, { role: 'user', origin: 'human', content: 'first' },
    { role: 'user', origin: 'framework', placement: 'before-human', content: 'reference one' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c', content: 'evidence' }, { role: 'assistant', content: 'done' }];
  const saved = structuredClone(history), first = placeFrameworkReferences(history);
  assert.deepEqual(first.map(message => message.content), ['stable', 'reference one', 'first', '', 'evidence', 'done']);
  const next = [...history, { role: 'user' as const, origin: 'human' as const, content: 'second' },
    { role: 'user' as const, origin: 'framework' as const, placement: 'before-human' as const, content: 'reference two' }];
  const placed = placeFrameworkReferences(next);
  assert.deepEqual(placed.slice(0, first.length), first);
  assert.deepEqual(placed.slice(-2).map(message => message.content), ['reference two', 'second']);
  assert.deepEqual(history, saved);
});

test('human messages cannot request placement and invalidated empty references are omitted', () => {
  const human: ContextMessage = { role: 'user', origin: 'human', placement: 'before-human', content: 'human' };
  assert.deepEqual(placeFrameworkReferences([human, { role: 'user', origin: 'framework', placement: 'before-human', content: '' }]), [human]);
});
