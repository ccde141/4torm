import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCycloneRoomCurrentInput, formatCycloneUsage, projectCycloneUsage, visibleCycloneUsage } from './cyclone-token-usage';
import { applyModelRequest, type CurrentInputEstimate } from '../../../lib/model-usage';
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

test('回复期间即时接受有效新计量，空回报不清展示', () => {
  const prior = { scope: 'workshop:seat', usage };
  const smaller = { promptTokens: 700, completionTokens: 10, totalTokens: 710 };
  assert.equal(projectCycloneUsage(prior, prior.scope, null, true), prior);
  assert.equal(projectCycloneUsage(prior, prior.scope, smaller, true).usage, smaller);
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
  assert.equal(projectCycloneUsage(loaded, loaded.scope, nextCall, true, nextCall).usage, nextCall);
  assert.equal(projectCycloneUsage(empty, empty.scope, nextCall, true).usage, nextCall);
});

test('群聊当前输入可随有效上下文减少，并标明参与者范围而不覆盖实时请求', () => {
  const estimate: CurrentInputEstimate = { tokens: 8_000, images: 0,
    model: 'fixture:model', estimatedAt: '2026-10-24T00:00:00Z' };
  assert.equal(formatCycloneRoomCurrentInput(estimate, 'zh-CN')?.label, '8.0K');
  const smaller = formatCycloneRoomCurrentInput({ ...estimate, tokens: 400 }, 'zh-CN');
  assert.equal(smaller?.label, '400');
  assert.match(smaller!.title, /当前参与者中最大的单次输入预估/);
  assert.match(formatCycloneRoomCurrentInput(estimate, 'en-US')!.title, /single current participant/);
  const progress = applyModelRequest(undefined, { id: 'r', purpose: 'conversation', state: 'sent',
    startedAt: '2026-10-24T00:00:01Z', updatedAt: '2026-10-24T00:00:01Z',
    estimatedInputTokens: 950, imageCount: 0, usageComplete: false });
  const live = formatCycloneRoomCurrentInput(estimate, 'zh-CN', progress);
  assert.equal(live?.label, '950');
  assert.doesNotMatch(live!.title, /最大的单次/);
});
