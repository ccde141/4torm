import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTideContextTokens, projectTideUsage } from './tide-token-label';

test('潮汐上下文 token 只显示最近有来源的请求，空用量显示未知', () => {
  assert.equal(formatTideContextTokens(undefined, 'zh-CN'), '未知');
  assert.equal(formatTideContextTokens({ promptTokens: 1234,
    completionTokens: 20, totalTokens: 1254 }, 'zh-CN'), '1,234');
  assert.equal(formatTideContextTokens(undefined, 'en-US'), 'Unknown');
});

test('执行中有效用量立即刷新，缺失回报保留上次值', () => {
  const old = { promptTokens: 12000, completionTokens: 20, totalTokens: 12020 };
  const compacted = { promptTokens: 1200, completionTokens: 20, totalTokens: 1220 };
  const current = { scope: 'agent:session', usage: old };
  assert.equal(projectTideUsage(current, current.scope, undefined, true), current);
  assert.equal(projectTideUsage(current, current.scope, compacted, true).usage, compacted);
  assert.equal(projectTideUsage(current, current.scope, undefined, false), current);
  const completed = projectTideUsage(current, current.scope, compacted, false);
  assert.equal(completed.usage, compacted);
  assert.equal(projectTideUsage(completed, 'other-agent:session', undefined, false).usage, undefined);
  assert.equal(projectTideUsage(completed, 'agent:other-session', undefined, true).usage, undefined);
  assert.equal(projectTideUsage({ scope: current.scope }, current.scope, old, true).usage, old);
});
