import assert from 'node:assert/strict';
import test from 'node:test';
import { appendNodeCompaction, nodeCompactionMarker, nodeContinuationAnswer } from './node-compaction';
import { projectNodeHistoryMessages } from './agent-chat-runtime';

const done = { type: 'compact-done' as const, id: 'compact-a', operation: 'compact' as const,
  summary: '交接资料', startedAt: 1, updatedAt: 2, reason: 'threshold' as const };

test('node success boundaries are stable through snapshots and repeated events without replacing old tools', () => {
  const initial = projectNodeHistoryMessages([{ role: 'assistant', content: 'old-answer', messageId: 'old',
    toolSteps: [{ tool: 'read_file', args: {}, result: 'old-result', status: 'done' }] }], () => 'generated');
  const marker = nodeCompactionMarker(done)!;
  const messages = appendNodeCompaction(initial, marker);
  assert.equal(appendNodeCompaction(messages, marker), messages);
  assert.equal(messages[0], initial[0]);
  assert.equal(messages[0].toolSteps?.[0].result, 'old-result');
  const restored = projectNodeHistoryMessages([{ role: 'system', content: marker.content,
    compaction: { id: done.id, summary: done.summary } }], () => 'unrelated');
  assert.equal(restored[0].id, marker.id);
  assert.equal(restored[0].type, 'compact-marker');
});

test('failed and incomplete compactions never add node dividers and final answers exclude already sealed text', () => {
  assert.equal(nodeCompactionMarker({ ...done, type: 'compact-failed' }), undefined);
  assert.equal(nodeCompactionMarker({ ...done, summary: undefined }), undefined);
  assert.equal(nodeCompactionMarker({ ...done, operation: 'reset' }), undefined);
  assert.equal(nodeContinuationAnswer('oldnew', 'old'), 'new');
  assert.equal(nodeContinuationAnswer('final answer', 'old'), 'final answer');
});
