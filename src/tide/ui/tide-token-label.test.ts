import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTideContextTokens } from './tide-token-label';

test('潮汐上下文 token 只显示最近有来源的请求，空用量显示未知', () => {
  assert.equal(formatTideContextTokens(undefined, 'zh-CN'), '未知');
  assert.equal(formatTideContextTokens({ promptTokens: 1234,
    completionTokens: 20, totalTokens: 1254 }, 'zh-CN'), '1,234');
  assert.equal(formatTideContextTokens(undefined, 'en-US'), 'Unknown');
});
