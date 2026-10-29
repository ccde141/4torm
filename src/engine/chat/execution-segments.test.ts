import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { executionCompactions, executionSegments, withExecutionBoundaries } from './execution-segments';
import { appendCompactionActivity } from './compaction-events';
import { buildConversationHistory } from './conversation-history';

const message: ChatMessage = { id: 'turn', role: 'assistant', content: 'BeforeAfterFinal', timestamp: '',
  toolSteps: [0, 1, 2].map(index => ({ tool: 'read_file', args: { path: `fixture-${index}.md` },
    status: 'done', result: `result-${index}` })),
  activitySequence: [{ kind: 'text', content: 'Before' }, { kind: 'tool', index: 0 },
    { kind: 'compact', markerId: 'compact-a', toolOffset: 1, timestamp: '2026-10-26T08:00:00Z' },
    { kind: 'text', content: 'After' }, { kind: 'tool', index: 1 },
    { kind: 'compact', markerId: 'compact-b', toolOffset: 2, timestamp: '2026-10-26T08:01:00Z' },
    { kind: 'tool', index: 2 }, { kind: 'text', content: 'Final' }],
};

test('multiple successful compactions split display without changing model context or tool identities', () => {
  const original = structuredClone(message);
  const reloaded = JSON.parse(JSON.stringify(message)) as ChatMessage;
  const projection = executionSegments(reloaded);
  assert.deepEqual(projection.segments.map(segment => ({ id: segment.id, offset: segment.toolOffset,
    continued: segment.continued, tools: segment.work.filter(item => item.kind === 'tool').map(item => item.index) })), [
    { id: 'turn', offset: 0, continued: true, tools: [0] },
    { id: 'compact-a', offset: 1, continued: true, tools: [1] },
    { id: 'compact-b', offset: 2, continued: false, tools: [2] },
  ]);
  assert.equal(projection.answer, 'Final');
  assert.deepEqual(message, original);
  assert.deepEqual(buildConversationHistory([message]), buildConversationHistory([{ ...message, activitySequence: undefined }]));
});

test('a retried marker does not split the same execution twice or move later tools', () => {
  const duplicated: ChatMessage = { ...message, activitySequence: [...message.activitySequence!,
    { kind: 'compact', markerId: 'compact-a', toolOffset: 1, timestamp: '2026-10-26T08:00:00Z' }] };
  assert.equal(executionSegments(duplicated).segments.length, 3);
  const marker: ChatMessage = { id: 'compact-a', role: 'system', timestamp: '', content: 'handoff',
    type: 'compact-marker', execution: { assistantId: 'turn', toolOffset: 1 } };
  assert.equal(appendCompactionActivity(message, marker), message);
});

test('only an exact inline reference hides a standalone handoff, missing assistants stay readable', () => {
  const markers: ChatMessage[] = ['compact-a', 'compact-b', 'orphan'].map((id, index) => ({ id, role: 'system',
    content: 'handoff', timestamp: '', type: 'compact-marker',
    execution: { assistantId: index < 2 ? 'turn' : 'missing', toolOffset: index + 1 } }));
  const projection = executionCompactions([markers[0], markers[1], markers[2], message]);
  assert.deepEqual([...projection.inlineMarkerIds], ['compact-a', 'compact-b']);
  assert.deepEqual(projection.byAssistant.get('turn')?.map(item => item.id), ['compact-a', 'compact-b']);
  assert.equal(executionCompactions([{ ...markers[0], execution: { assistantId: 'turn', toolOffset: 9 } }, message])
    .inlineMarkerIds.size, 0);
});

test('legacy markers never invent an execution segment', () => {
  const marker: ChatMessage = { id: 'legacy', role: 'system', timestamp: '', content: 'summary', type: 'compact-marker' };
  const legacy: ChatMessage = { ...message, activitySequence: [{ kind: 'tool', index: 0 }] };
  assert.equal(appendCompactionActivity(legacy, marker), legacy);
  assert.equal(executionCompactions([marker, legacy]).inlineMarkerIds.size, 0);
  assert.equal(executionSegments(legacy).segments.length, 1);
});

test('a committed marker restores a missing boundary inside merged prose without modifying the saved message', () => {
  const original: ChatMessage = { ...message, content: 'BeforeAfterFinal', activitySequence: [
    { kind: 'tool', index: 0 }, { kind: 'text', content: 'BeforeAfter' },
    { kind: 'tool', index: 1 }, { kind: 'text', content: 'Final' },
  ] };
  const marker: ChatMessage = { id: 'crash-checkpoint', role: 'system', timestamp: '',
    type: 'compact-marker', content: 'handoff', execution: { assistantId: 'turn', toolOffset: 1, textOffset: 6 } };
  const saved = structuredClone(original);
  const restored = withExecutionBoundaries(original, [marker, marker]);
  assert.deepEqual(restored.activitySequence?.map(item => item.kind), ['tool', 'text', 'compact', 'text', 'tool', 'text']);
  const { segments, answer } = executionSegments(original, [marker]);
  assert.deepEqual(segments[0].work, [{ kind: 'tool', index: 0 }, { kind: 'text', content: 'Before' }]);
  assert.deepEqual(segments[1].work, [{ kind: 'text', content: 'After' }, { kind: 'tool', index: 1 }]);
  assert.equal(answer, 'Final');
  assert.deepEqual(original, saved);
  assert.equal(executionCompactions([marker, original]).inlineMarkerIds.has(marker.id), true);
});

test('a marker without a recoverable assistant remains a standalone history entry', () => {
  const raw = { ...message, activitySequence: undefined };
  const marker: ChatMessage = { id: 'raw-marker', role: 'system', timestamp: '', type: 'compact-marker',
    content: 'handoff', execution: { assistantId: 'turn', toolOffset: 1, textOffset: 2 } };
  assert.equal(withExecutionBoundaries(raw, [marker]), raw);
  assert.equal(executionCompactions([raw, marker]).inlineMarkerIds.size, 0);
});

test('reasoning ranges use committed offsets and older markers retain all reasoning once', () => {
  const value = { ...message, reasoningContent: 'beforemiddleafter' };
  const markers: ChatMessage[] = [{ id: 'compact-a', role: 'system', type: 'compact-marker', content: '', timestamp: '',
    execution: { assistantId: 'turn', toolOffset: 1, reasoningOffset: 6 } },
  { id: 'compact-b', role: 'system', type: 'compact-marker', content: '', timestamp: '',
    execution: { assistantId: 'turn', toolOffset: 2, reasoningOffset: 12 } }];
  const exact = executionSegments(value, markers).segments.map(segment => value.reasoningContent.slice(segment.reasoningStart, segment.reasoningEnd));
  assert.deepEqual(exact, ['before', 'middle', 'after']);
  const legacy = executionSegments(value).segments.map(segment => value.reasoningContent.slice(segment.reasoningStart, segment.reasoningEnd));
  assert.deepEqual(legacy, ['beforemiddleafter', '', '']);
});
