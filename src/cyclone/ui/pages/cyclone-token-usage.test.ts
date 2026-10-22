import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCycloneUsage, projectCycloneUsage, visibleCycloneUsage } from './cyclone-token-usage';
import { applySeatEvent, emptyLive } from './seat-stream-events';
import { applyRoomEvent, type RoomEventState } from './room-stream-events';

const usage = { promptTokens: 2_450, completionTokens: 45, totalTokens: 2_495 };

test('最新事件优先于旧 status，null 明确清空旧实测', () => {
  assert.equal(visibleCycloneUsage(undefined, usage)?.promptTokens, 2_450);
  assert.equal(visibleCycloneUsage(null, usage), null);
  assert.equal(visibleCycloneUsage(usage, undefined)?.promptTokens, 2_450);
});

test('只显示请求输入 token 且缺失用量可辨认', () => {
  assert.equal(formatCycloneUsage(usage, 'zh-CN').label, '2.5K tokens');
  assert.equal(formatCycloneUsage(null, 'zh-CN').label, 'Token 未知');
});

test('公聊应显示最新请求而非本轮最大输入', () => {
  const latest = { promptTokens: 700, completionTokens: 10, totalTokens: 710 };
  assert.equal(formatCycloneUsage(visibleCycloneUsage(undefined, latest), 'zh-CN').label,
    '700 tokens');
});

test('回复和压缩期间保留已知值，完成后接受下降的实测，空值不清展示', () => {
  const prior = { scope: 'workshop:seat', usage };
  const smaller = { promptTokens: 700, completionTokens: 10, totalTokens: 710 };
  assert.equal(projectCycloneUsage(prior, prior.scope, null, true), prior);
  assert.equal(projectCycloneUsage(prior, prior.scope, smaller, true), prior);
  const done = projectCycloneUsage(prior, prior.scope, smaller, false);
  assert.equal(done.usage, smaller);
  assert.equal(projectCycloneUsage(done, done.scope, null, false), done);
  assert.equal(projectCycloneUsage(done, done.scope, undefined, false), done);
  assert.equal(projectCycloneUsage(done, 'other-workshop:seat', undefined, false).usage, undefined);
});

test('工位和会议流保留展示候选，同时保持缺失计量的事实为 null', () => {
  const seat = emptyLive();
  const room: RoomEventState = { roundFeed: [], activeSpeaker: '' };
  for (const apply of [() => {
    applySeatEvent({ type: 'usage', usage }, seat);
    applySeatEvent({ type: 'usage', usage: null }, seat);
    return seat;
  }, () => {
    applyRoomEvent({ type: 'usage', usage }, room);
    applyRoomEvent({ type: 'usage', usage: null }, room);
    return room;
  }]) {
    const live = apply();
    assert.equal(live.tokenUsage, null);
    assert.equal(live.lastKnownTokenUsage, usage);
  }
});

test('忙中打开已有会话，迟到的同身份历史计量可建立展示基线', () => {
  const empty = { scope: 'workshop:seat' };
  const loaded = projectCycloneUsage(empty, empty.scope, null, true, usage);
  assert.equal(loaded.usage, usage);
  const nextCall = { promptTokens: 3000, completionTokens: 20, totalTokens: 3020 };
  assert.equal(projectCycloneUsage(loaded, loaded.scope, nextCall, true, nextCall), loaded);
  assert.equal(projectCycloneUsage(empty, empty.scope, nextCall, true), empty);
});
