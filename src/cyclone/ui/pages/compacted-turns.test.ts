import assert from 'node:assert/strict';
import test from 'node:test';
import { applySeatEvent, emptyLive } from './seat-stream-events';
import { applyRoomEvent, type RoomEventState } from './room-stream-events';
import { createLiveSeatTurn } from './seat-turn-projection';
import { compactedRoomTurns, compactedSeatTurns } from './compacted-turns';
import { projectSeatDisplayHistory } from './seat-display-history';
import { publicToFeed } from './room-messages';

const done = { type: 'compact-done', id: 'compact-fixture', operation: 'compact', summary: '交接资料',
  startedAt: 1, updatedAt: 2, reason: 'threshold' };

test('seat continuations split tools and reasoning at committed boundaries without losing the original turn', () => {
  const live = emptyLive();
  applySeatEvent({ type: 'reasoning', content: '前段思考' }, live);
  applySeatEvent({ type: 'token', content: '前段说明' }, live);
  applySeatEvent({ type: 'tool-call', tool: 'read_file', args: { path: 'before' } }, live);
  applySeatEvent({ type: 'tool-result', tool: 'read_file', result: 'before-result', ok: true }, live);
  applySeatEvent(done, live); applySeatEvent(done, live);
  applySeatEvent({ type: 'reasoning', content: '后段思考' }, live);
  applySeatEvent({ type: 'tool-call', tool: 'read_file', args: { path: 'after' } }, live);
  applySeatEvent({ type: 'tool-result', tool: 'read_file', result: 'after-result', ok: true }, live);
  applySeatEvent({ type: 'token', content: '最终答复' }, live);
  const turn = createLiveSeatTurn(live.segments, live.reasoning);
  const original = structuredClone(turn);
  const parts = compactedSeatTurns(turn);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.continued), [true, false]);
  assert.deepEqual(parts.map(part => part.turn.reasoning), ['前段思考', '后段思考']);
  assert.deepEqual(parts.map(part => part.turn.workSegments.flatMap(segment => segment.blocks)
    .filter(block => block.kind === 'tool').map(block => block.result)), [['before-result'], ['after-result']]);
  assert.equal(parts[1].turn.finalContent, '最终答复');
  assert.deepEqual(turn, original);
});

test('room continuations use stable success identity and do not repeat old text as a new final answer', () => {
  const state: RoomEventState = { roundFeed: [], activeSpeaker: '' };
  applyRoomEvent({ type: 'seat-start', speaker: '工位', turnId: 'round-a' }, state);
  applyRoomEvent({ type: 'reasoning', content: '前思考' }, state);
  applyRoomEvent({ type: 'token', content: '前说明' }, state);
  applyRoomEvent({ type: 'tool-call', tool: 'read_file', args: {} }, state);
  applyRoomEvent({ type: 'tool-result', result: 'before', ok: true }, state);
  applyRoomEvent(done, state); applyRoomEvent(done, state);
  applyRoomEvent({ type: 'reasoning', content: '后思考' }, state);
  applyRoomEvent({ type: 'tool-call', tool: 'read_file', args: {} }, state);
  applyRoomEvent({ type: 'tool-result', result: 'after', ok: true }, state);
  const source = structuredClone(state.roundFeed[0]);
  const parts = compactedRoomTurns(source);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.message.reasoning), ['前思考', '后思考']);
  assert.deepEqual(parts.map(part => part.message.tools.length), [1, 1]);
  assert.equal(parts[1].message.content, '');
  assert.deepEqual(state.roundFeed[0], source);
});

test('failed, incomplete and reset events never create a successful continuation', () => {
  const live = emptyLive();
  for (const event of [{ ...done, type: 'compact-failed' }, { ...done, summary: undefined }, { ...done, operation: 'reset' }]) {
    applySeatEvent(event, live);
  }
  assert.equal(live.segments.length, 0);
});

test('read-only archived seats and room records keep active edit indexes in their original coordinate system', () => {
  const messages = [{ role: 'system', content: 'active-summary' }, { role: 'user', content: 'retained-input' },
    { role: 'assistant', content: 'new-answer' }];
  const history = { messages: [{ role: 'user', content: 'old-input' }, { role: 'assistant', content: 'old-answer' },
    { role: 'system', content: '[历史压缩记录]\n交接' }], contextOffset: 2 };
  const seat = projectSeatDisplayHistory(messages, history, '确认');
  assert.deepEqual(seat.map(message => message.content), ['old-input', 'old-answer', '[历史压缩记录]\n交接', 'new-answer']);
  assert.ok(seat.slice(0, 3).every(message => message.sourceIndex === undefined));
  assert.equal(seat[3].sourceIndex, 2);
  const room = publicToFeed([{ speaker: '系统', content: 'summary', timestamp: 1 },
    { speaker: '工位', content: 'new-answer', timestamp: 2 }], {
    contextOffset: 1, messages: [{ speaker: '工位', content: 'old-answer', timestamp: 1 },
      { speaker: '系统', content: '[历史压缩记录]\n交接', timestamp: 2 }],
  });
  assert.deepEqual(room.map(message => message.content), ['old-answer', '[历史压缩记录]\n交接', 'new-answer']);
  assert.deepEqual(room.map(message => message.sourceIndex), [undefined, undefined, 1]);
});

test('a durable room draft restores its inline boundary without changing active edit indexes', () => {
  const draft = { turnId: 'draft-turn', speaker: '工位', content: '未完原文', timestamp: 2,
    segments: [{ kind: 'text' as const, content: '未完原文' },
      { kind: 'compaction' as const, id: 'draft-compact', summary: '已保存交接', reasoningOffset: 0 }] };
  const active = [{ speaker: '人类', content: '继续', timestamp: 1 }];
  const history = publicToFeed(active, undefined, JSON.parse(JSON.stringify(draft)));
  assert.equal(history[0].sourceIndex, 0);
  assert.equal(history[1].sourceIndex, undefined);
  assert.equal(history[1].turnId, draft.turnId);
  assert.equal(compactedRoomTurns(history[1])[1].boundary?.id, 'draft-compact');
  assert.equal(publicToFeed([...active, draft], undefined, draft).filter(message => message.turnId === draft.turnId).length, 1);
});
