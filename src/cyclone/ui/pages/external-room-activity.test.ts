import assert from 'node:assert/strict';
import test from 'node:test';
import { applyExternalRoomActivity, publicRoomFact } from './external-room-activity.js';

const base = {
  operationId: 'room:workshop-a:room-a', runId: 'run-a',
  message: 'Discuss the design', running: true, latestSeq: 2, truncated: false,
  events: [
    { seq: 1, event: { type: 'seat-start', speaker: 'Researcher', turnId: 'turn-a' } },
    { seq: 2, event: { type: 'token', speaker: 'Researcher', content: 'hello' } },
  ],
};

test('public room compaction feedback uses the same live projection as human room streams', () => {
  const first = applyExternalRoomActivity(null, { ...base, latestSeq: 3, events: [
    { seq: 1, event: { type: 'input-accepted' } },
    { seq: 2, event: { type: 'compaction-notice', message: '压缩使用会长模型兜底' } },
    { seq: 3, event: { type: 'usage', usage: null } },
  ] }, 'zh-CN');
  assert.equal(first.compactionNotice, '压缩使用会长模型兜底');
  const next = applyExternalRoomActivity(first, { ...base, runId: 'next-run', latestSeq: 1,
    events: [{ seq: 1, event: { type: 'input-accepted' } }] }, 'zh-CN');
  assert.equal(next.compactionNotice, null);
});

test('external room activity uses the same room event projector and ignores duplicate cursors', () => {
  const first = applyExternalRoomActivity(null, base, 'zh-CN');
  assert.equal(first?.roundFeed[0]?.content, 'Discuss the design');
  assert.equal(first?.roundFeed[1]?.content, 'hello');
  const repeat = applyExternalRoomActivity(first, base, 'zh-CN');
  assert.equal(repeat?.roundFeed[1]?.content, 'hello');
  const next = applyExternalRoomActivity(repeat, {
    ...base, latestSeq: 3,
    events: [{ seq: 3, event: { type: 'token', speaker: 'Researcher', content: ' world' } }],
  }, 'zh-CN');
  assert.equal(next?.roundFeed[1]?.content, 'hello world');
});

test('a changed run identity resets live text and a truncated replay stays marked incomplete', () => {
  const first = applyExternalRoomActivity(null, base, 'zh-CN');
  const next = applyExternalRoomActivity(first, {
    ...base, runId: 'run-b', message: 'second', latestSeq: 1,
    events: [{ seq: 1, event: { type: 'seat-start', speaker: 'Writer', turnId: 'turn-b' } }],
  }, 'zh-CN');
  assert.deepEqual(next?.roundFeed.map(item => item.content), ['second', '']);
  const truncated = applyExternalRoomActivity(next, {
    ...base, runId: 'run-c', message: 'third', truncated: true,
    events: [],
  }, 'zh-CN');
  assert.equal(truncated?.incomplete, true);
  assert.deepEqual(truncated?.roundFeed.map(item => item.content), ['third']);
});

test('a clipped event marks the room feed incomplete but does not stop later tokens', () => {
  const clipped = applyExternalRoomActivity(null, { ...base, truncated: true }, 'zh-CN');
  assert.equal(clipped.incomplete, true);
  assert.equal(clipped.roundFeed[1]?.content, 'hello');
  const next = applyExternalRoomActivity(clipped, { ...base, truncated: true, latestSeq: 3,
    events: [{ seq: 3, event: { type: 'token', speaker: 'Researcher', content: ' world' } }],
  }, 'zh-CN');
  assert.equal(next.roundFeed[1]?.content, 'hello world');
});

test('chair private chat fact cannot be displayed as the public room round', () => {
  const fact = { operationId: 'room:workshop-a:room-a', runId: 'chair-run',
    title: 'Room', status: 'crashed' as const, phase: 'chair-chat' };
  assert.equal(publicRoomFact(fact), null);
  assert.equal(publicRoomFact({ ...fact, phase: 'room-speak' })?.runId, 'chair-run');
});

test('外部群聊每次模型调用的计量可重放，未知值覆盖旧值', () => {
  const usage = { promptTokens: 1_100, completionTokens: 20, totalTokens: 1_120 };
  const first = applyExternalRoomActivity(null, {
    ...base, latestSeq: 1, events: [{ seq: 1, event: { type: 'usage', usage } }],
  }, 'zh-CN');
  assert.deepEqual(first.tokenUsage, usage);
  const next = applyExternalRoomActivity(first, {
    ...base, latestSeq: 2, events: [{ seq: 2, event: { type: 'usage', usage: null } }],
  }, 'zh-CN');
  assert.equal(next.tokenUsage, null);
});
