import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConvectionUsage, beginConvectionUsage, formatConvectionUsage,
  mergeConvectionSessions, restoreConvectionUsage, type ConvectionUsagePending } from './convection-token-usage';

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

test('整轮回复和压缩冻结已知数值，流式候选只在终态刷新且公私聊互不覆盖', () => {
  const nextUsage = { promptTokens: 8_000, completionTokens: 300, totalTokens: 8_300 };
  const rooms = [{ id: 'a', publicLatestTokenUsage: actual, chairTokenUsage: actual,
    usagePending: undefined as ConvectionUsagePending | undefined }, { id: 'b' }];
  let current = beginConvectionUsage(beginConvectionUsage(rooms, 'a', 'public'), 'a', 'chair');
  current = applyConvectionUsage(current, 'a', 'public', null);
  current = applyConvectionUsage(current, 'a', 'public', nextUsage);
  current = mergeConvectionSessions(current, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(current[0].publicLatestTokenUsage, actual);
  assert.equal(current[0].chairTokenUsage, actual);
  assert.equal(current[0].usagePending?.public, nextUsage);
  const done = restoreConvectionUsage(current, 'a', {}, 'chair');
  assert.equal(done[0].publicLatestTokenUsage, nextUsage);
  assert.equal(done[0].usagePending?.public, undefined);
  assert.equal(done[0].usagePending?.chair, null);
  assert.equal(done[1].publicLatestTokenUsage, undefined);
});

test('重连中的计量暂存，终态真实值优先；缺失计量保留此前数值而零值仍有效', () => {
  const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let current = mergeConvectionSessions([{ id: 'a', publicLatestTokenUsage: actual }],
    [{ id: 'a', publicLatestTokenUsage: zero }], { sessionId: 'a', round: 'public' });
  assert.equal(current[0].publicLatestTokenUsage, actual);
  current = restoreConvectionUsage(current, 'a', { publicLatestTokenUsage: zero });
  assert.equal(current[0].publicLatestTokenUsage, zero);
  assert.equal(formatConvectionUsage(current[0].publicLatestTokenUsage, 0, 'zh-CN').compactLabel, '0');
  current = restoreConvectionUsage(beginConvectionUsage(current, 'a', 'public'), 'a', {});
  assert.equal(current[0].publicLatestTokenUsage, zero);
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
