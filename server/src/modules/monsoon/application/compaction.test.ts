import assert from 'node:assert/strict';
import test from 'node:test';
import type { MonsoonSession } from '../domain/session.js';
import { prepareCompaction, applyCompaction } from './compaction.js';

function message(index: number, role: 'user' | 'assistant' = 'user') {
  return {
    id: `message-${index}`, role, content: `content-${index}`.repeat(4000),
    timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
}

function session(): MonsoonSession {
  return {
    id: 'session-a', agentId: 'agent-a', agentName: 'A', title: 'Title',
    messages: Array.from({ length: 12 }, (_, index) => message(index,
      index % 2 ? 'assistant' : 'user')),
    model: 'provider:model', systemPrompt: '', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', revision: 4, messageRevision: 3,
    tokenUsage: { promptTokens: 12_000, completionTokens: 100, totalTokens: 12_100 },
  };
}

test('manual compaction prepares only the older prefix before the latest four complete human turns', () => {
  const prepared = prepareCompaction(session());
  assert.equal(prepared.expectedRevision, 4);
  assert.equal(prepared.compressedCount, 4);
  assert.match(prepared.dialogText, /content-0/);
  assert.match(prepared.dialogText, /content-3/);
  assert.doesNotMatch(prepared.dialogText, /content-4|content-11/);
});

test('manual compaction inserts one final marker, preserves raw history, and clears stale usage', () => {
  const compacted = applyCompaction(session(), prepareCompaction(session()), 'summary', 'marker-a');
  assert.equal(compacted.messages[12]?.id, 'marker-a');
  assert.equal(compacted.messages[12]?.type, 'compact-marker');
  assert.equal(compacted.messages[11]?.id, 'message-11');
  assert.equal(compacted.tokenUsage, undefined);
});

test('manual compaction respects history protection independently of stale reported usage', () => {
  const value = session();
  value.tokenUsage = { promptTokens: 100, completionTokens: 10, totalTokens: 110 };
  assert.equal(prepareCompaction(value).compressedCount, 4);
  assert.throws(() => prepareCompaction({ ...value, messages: value.messages.slice(-8) }), /近期原文均受保护/);
  assert.throws(() => prepareCompaction({ ...value, messages: [] }), /没有可压缩/);
});
