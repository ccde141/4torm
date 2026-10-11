import assert from 'node:assert/strict';
import test from 'node:test';
import { applyExternalPrivateActivity, privateChatFact } from './external-private-activity.js';

const base = {
  operationId: 'seat:workshop-a:seat-a', runId: 'run-a', phase: 'seat-chat' as const,
  message: 'Review this', running: true, latestSeq: 2, truncated: false,
  events: [{ seq: 1, event: { type: 'token', content: 'hello' } },
    { seq: 2, event: { type: 'reasoning', content: 'thinking' } }],
};

test('private compaction feedback survives provider usage omission and clears on accepted human input', () => {
  const first = applyExternalPrivateActivity(null, { ...base, latestSeq: 2, events: [
    { seq: 1, event: { type: 'compaction-notice', message: '主模型离线，已切换备用模型' } },
    { seq: 2, event: { type: 'usage', usage: null } },
  ] }, 'zh-CN');
  assert.equal(first.live.compactionNotice, '主模型离线，已切换备用模型');
  const next = applyExternalPrivateActivity(first, { ...base, latestSeq: 3, events: [
    { seq: 3, event: { type: 'input-accepted' } },
  ] }, 'zh-CN');
  assert.equal(next.live.compactionNotice, null);
  assert.equal(next.live.segments.length, 0);
});

test('Agent private chat uses the human seat event projection across incremental pages', () => {
  const first = applyExternalPrivateActivity(null, base, 'zh-CN');
  assert.equal(first.live.segments[0]?.content, 'hello');
  assert.equal(first.live.reasoning, 'thinking');
  const repeated = applyExternalPrivateActivity(first, base, 'zh-CN');
  assert.equal(repeated.live.segments[0]?.content, 'hello');
  const next = applyExternalPrivateActivity(repeated, { ...base, latestSeq: 3,
    events: [{ seq: 3, event: { type: 'token', content: ' world' } }] }, 'zh-CN');
  assert.equal(next.live.segments[0]?.content, 'hello world');
});

test('changed runs reset private text and a cursor gap remains explicit', () => {
  const first = applyExternalPrivateActivity(null, base, 'zh-CN');
  const next = applyExternalPrivateActivity(first, { ...base, runId: 'run-b',
    message: 'new question', latestSeq: 1, events: [{ seq: 1, event: { type: 'token', content: 'new' } }] }, 'zh-CN');
  assert.equal(next.message, 'new question');
  assert.equal(next.live.segments[0]?.content, 'new');
  const gap = applyExternalPrivateActivity(next, { ...base, runId: 'run-c', truncated: true,
    events: [] }, 'zh-CN');
  assert.equal(gap.incomplete, true);
  assert.deepEqual(gap.live.segments, []);
});

test('clipped private events keep a visible live stream and later pages continue it', () => {
  const clipped = applyExternalPrivateActivity(null, { ...base, truncated: true }, 'zh-CN');
  assert.equal(clipped.incomplete, true);
  assert.equal(clipped.live.segments[0]?.content, 'hello');
  const next = applyExternalPrivateActivity(clipped, { ...base, truncated: true, latestSeq: 3,
    events: [{ seq: 3, event: { type: 'token', content: ' world' } }],
  }, 'zh-CN');
  assert.equal(next.live.segments[0]?.content, 'hello world');
});

test('public room fact cannot pose as chair private chat completion', () => {
  const fact = { operationId: 'room:workshop-a:room-a', runId: 'run-c',
    title: 'Room', status: 'failed' as const, phase: 'room-speak' };
  assert.equal(privateChatFact(fact, 'chair'), null);
  assert.equal(privateChatFact({ ...fact, phase: 'chair-chat' }, 'chair')?.runId, 'run-c');
  assert.equal(privateChatFact({ ...fact, phase: 'chair-chat' }, 'seat'), null);
});
