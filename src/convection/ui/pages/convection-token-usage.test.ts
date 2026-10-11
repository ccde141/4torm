import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConvectionUsage, formatConvectionUsage } from './convection-token-usage';

const actual = { promptTokens: 12_300, completionTokens: 200, totalTokens: 12_500 };

test('公聊与会长使用各自的最近计量，未知调用清除旧值', () => {
  const sessions = [{ id: 'a', tokenUsage: actual, publicLatestTokenUsage: actual,
    chairTokenUsage: actual }, { id: 'b' }];
  const chair = applyConvectionUsage(sessions, 'a', 'chair', null);
  assert.equal(chair[0].tokenUsage?.promptTokens, 12_300);
  assert.equal(chair[0].chairTokenUsage, undefined);
  assert.equal(chair[1], sessions[1]);
  const publicNext = applyConvectionUsage(chair, 'a', 'public', null);
  assert.equal(publicNext[0].publicLatestTokenUsage, undefined);
  assert.equal(publicNext[0].tokenUsage?.promptTokens, 12_300);
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
