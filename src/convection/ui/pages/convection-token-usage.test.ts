import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConvectionModelRequest, applyConvectionUsage, beginConvectionUsage, formatConvectionUsage,
  mergeConvectionSessions, restoreConvectionUsage, type ConvectionUsagePending } from './convection-token-usage';
import type { CurrentInputEstimate, ModelRequestUsage, ModelUsageProgress } from '../../../lib/model-usage';

const actual = { promptTokens: 12_300, completionTokens: 200, totalTokens: 12_500 };

test('公聊与会长使用各自的最近计量，未知调用不清除已显示的真实值', () => {
  const sessions = [{ id: 'a', tokenUsage: actual, publicLatestTokenUsage: actual,
    chairTokenUsage: actual }, { id: 'b' }];
  const chair = applyConvectionUsage(sessions, 'a', 'chair', null);
  assert.equal(chair[0].tokenUsage?.promptTokens, 12_300);
  assert.equal(chair[0].chairTokenUsage, actual);
  assert.equal(chair[1], sessions[1]);
  const publicNext = applyConvectionUsage(chair, 'a', 'public', null);
  assert.equal(publicNext[0].publicLatestTokenUsage, actual);
  assert.equal(publicNext[0].tokenUsage?.promptTokens, 12_300);
});

test('模型每次返回实际计量就刷新，公私聊互不覆盖', () => {
  const nextUsage = { promptTokens: 8_000, completionTokens: 300, totalTokens: 8_300 };
  const rooms = [{ id: 'a', publicLatestTokenUsage: actual, chairTokenUsage: actual,
    usagePending: undefined as ConvectionUsagePending | undefined }, { id: 'b' }];
  let current = beginConvectionUsage(beginConvectionUsage(rooms, 'a', 'public'), 'a', 'chair');
  current = applyConvectionUsage(current, 'a', 'public', null);
  current = applyConvectionUsage(current, 'a', 'public', nextUsage);
  current = mergeConvectionSessions(current, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(current[0].publicLatestTokenUsage, nextUsage);
  assert.equal(current[0].chairTokenUsage, actual);
  assert.equal(current[0].usagePending?.public, nextUsage);
  const done = restoreConvectionUsage(current, 'a', {}, 'chair');
  assert.equal(done[0].publicLatestTokenUsage, nextUsage);
  assert.equal(done[0].usagePending?.public, undefined);
  assert.equal(done[0].usagePending?.chair, null);
  assert.equal(done[1].publicLatestTokenUsage, undefined);
});

test('重连即展示真实计量，缺失计量保留此前数值而零值仍有效', () => {
  const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let current = mergeConvectionSessions([{ id: 'a', publicLatestTokenUsage: actual }],
    [{ id: 'a', publicLatestTokenUsage: zero }], { sessionId: 'a', round: 'public' });
  assert.equal(current[0].publicLatestTokenUsage, zero);
  current = restoreConvectionUsage(current, 'a', { publicLatestTokenUsage: zero });
  assert.equal(current[0].publicLatestTokenUsage, zero);
  assert.equal(formatConvectionUsage(current[0].publicLatestTokenUsage, 0, 'zh-CN').compactLabel, '0');
  current = restoreConvectionUsage(beginConvectionUsage(current, 'a', 'public'), 'a', {});
  assert.equal(current[0].publicLatestTokenUsage, zero);
});

test('公聊和助理请求账本隔离，预计值即时显示且失败后重载不回退', () => {
  const request: ModelRequestUsage = { id: 'public-request', purpose: 'conversation', state: 'sent',
    startedAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.001Z',
    estimatedInputTokens: 2345, imageCount: 1, usageComplete: false };
  const initial: Array<{ id: string; publicModelUsage?: ModelUsageProgress; chairModelUsage?: ModelUsageProgress }> = [{ id: 'a' }, { id: 'b' }];
  let current = applyConvectionModelRequest(initial, 'a', 'public', request);
  current = applyConvectionModelRequest(current, 'a', 'chair', { ...request, id: 'chair-request', estimatedInputTokens: 99 });
  assert.equal(formatConvectionUsage(undefined, 0, 'zh-CN', current[0].publicModelUsage).compactLabel, '2.3K');
  assert.equal(formatConvectionUsage(undefined, 0, 'zh-CN', current[0].chairModelUsage).compactLabel, '99');
  current = applyConvectionModelRequest(current, 'a', 'public', { ...request,
    state: 'failed', updatedAt: '2026-10-24T00:00:00.002Z', usage: actual });
  const stale = applyConvectionModelRequest(initial, 'a', 'public', request);
  current = mergeConvectionSessions(current, stale);
  current = restoreConvectionUsage(current, 'a', {});
  assert.equal(current[0].publicModelUsage?.requests['public-request'].state, 'failed');
  assert.equal(current[0].publicModelUsage?.total.totalTokens, actual.totalTokens);
  assert.equal(current[0].chairModelUsage?.latest?.estimatedInputTokens, 99);
  assert.equal(current[1].publicModelUsage, undefined);
});

test('列表按会议身份保留计量，不把上一会议数值带到新增或重排的会议', () => {
  const current = [{ id: 'a', publicLatestTokenUsage: actual }, { id: 'b' }];
  const reordered = mergeConvectionSessions(current, [{ id: 'b' }, { id: 'c' }, { id: 'a' }]);
  assert.equal(reordered[0].publicLatestTokenUsage, undefined);
  assert.equal(reordered[1].publicLatestTokenUsage, undefined);
  assert.equal(reordered[2].publicLatestTokenUsage, actual);
  assert.deepEqual(mergeConvectionSessions(current, []), []);
});

test('界面显示 provider 输入用量，缺失时明确标未知和估算', () => {
  const reported = formatConvectionUsage(actual, 900, 'zh-CN');
  assert.equal(reported.label, '12.3K tokens');
  assert.equal(reported.compactLabel, '12.3K');
  const missing = formatConvectionUsage(undefined, 900, 'zh-CN');
  assert.equal(missing.label, 'Token 未知');
  assert.equal(missing.compactLabel, '未知');
  assert.equal(formatConvectionUsage(undefined, 900, 'en-US').compactLabel, 'Unknown');
  assert.match(missing.title, /估算/);
  assert.match(missing.title, /900/);
});

test('当前上下文预估优先于旧实测，公私重载分别接受压缩后的较小值', () => {
  const estimate = (tokens: number): CurrentInputEstimate => ({ tokens, images: 0,
    model: 'fixture:model', estimatedAt: '2026-10-24T03:00:00.000Z', basis: 'compiled' });
  const initial = [{ id: 'a', publicLatestTokenUsage: actual, chairTokenUsage: actual,
    publicCurrentInput: estimate(24_000), chairCurrentInput: estimate(3_000) }];
  const next = restoreConvectionUsage(initial, 'a', { publicCurrentInput: estimate(2_000),
    chairCurrentInput: estimate(800) });
  assert.equal(formatConvectionUsage(actual, 999_999, 'zh-CN', undefined,
    next[0].publicCurrentInput).compactLabel, '2.0K');
  assert.equal(formatConvectionUsage(actual, 999_999, 'zh-CN', undefined,
    next[0].chairCurrentInput).compactLabel, '800');
  assert.equal(next[0].publicLatestTokenUsage, actual);
  const reloaded = mergeConvectionSessions(next, [{ ...initial[0], publicCurrentInput: estimate(400) }]);
  assert.equal(reloaded[0].publicCurrentInput.tokens, 400);
  assert.equal(reloaded[0].chairCurrentInput.tokens, 3_000);
});

test('公开预估说明最大单次参与者输入，实时请求和助理私聊不冒充这个范围', () => {
  const estimate: CurrentInputEstimate = { tokens: 2_000, images: 0, model: 'fixture:model',
    estimatedAt: '2026-10-24T03:00:00.000Z', basis: 'compiled' };
  const publicLabel = formatConvectionUsage(actual, 99_999, 'zh-CN', undefined, estimate, 'public');
  assert.match(publicLabel.title, /当前参与者中最大的单次输入预估/);
  assert.match(formatConvectionUsage(actual, 99_999, 'en-US', undefined, estimate, 'public').title,
    /Largest estimated input for a single current participant/);
  assert.doesNotMatch(formatConvectionUsage(actual, 0, 'zh-CN', undefined, estimate, 'chair').title, /最大/);
  const request: ModelRequestUsage = { id: 'live', purpose: 'conversation', state: 'sent',
    startedAt: '2026-10-24T04:00:00.000Z', updatedAt: '2026-10-24T04:00:00.001Z',
    estimatedInputTokens: 4_000, imageCount: 0, usageComplete: false };
  const running = applyConvectionModelRequest([{ id: 'a', publicModelUsage: undefined as ModelUsageProgress | undefined }],
    'a', 'public', request)[0].publicModelUsage;
  const live = formatConvectionUsage(actual, 0, 'zh-CN', running, estimate, 'public');
  assert.equal(live.compactLabel, '4.0K');
  assert.doesNotMatch(live.title, /最大/);
  const newer = { ...request, state: 'completed' as const, updatedAt: '2026-10-24T05:00:00.000Z' };
  const recent = applyConvectionModelRequest([{ id: 'a', publicModelUsage: running }], 'a', 'public', newer)[0].publicModelUsage;
  assert.doesNotMatch(formatConvectionUsage(actual, 0, 'zh-CN', recent, estimate, 'public').title, /最大/);
  const stale = { ...request, id: 'stale', startedAt: '2026-10-24T01:00:00.000Z',
    updatedAt: '2026-10-24T01:00:00.001Z' };
  const recovered = applyConvectionModelRequest([{ id: 'a', publicModelUsage: undefined as ModelUsageProgress | undefined }],
    'a', 'public', stale)[0].publicModelUsage;
  const restored = formatConvectionUsage(actual, 0, 'zh-CN', recovered, estimate, 'public');
  assert.equal(restored.compactLabel, '2.0K');
  assert.match(restored.title, /当前参与者中最大的单次输入预估/);
});
