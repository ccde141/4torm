import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTokenUsage,
  tokenUsageFromMeta,
  tokenUsageToMeta,
} from './chat-token';

test('session index preserves provider prompt and completion usage', () => {
  const usage = { promptTokens: 12_000, completionTokens: 345, totalTokens: 12_345 };
  assert.deepEqual(tokenUsageFromMeta(tokenUsageToMeta(usage)), usage);
  assert.deepEqual(tokenUsageFromMeta({ tk: 9000 }), {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 9000,
  });
});

test('cleared usage is visibly pending instead of reusing a stale pre-compact value', () => {
  assert.deepEqual(tokenUsageToMeta(undefined), {});
  assert.deepEqual(formatTokenUsage(undefined), { label: '--', title: '本次用量未知' });
  assert.deepEqual(formatTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 9000 }), {
    label: '--',
    title: '历史总量 9.0K tokens · 本次未知',
  });
  assert.deepEqual(formatTokenUsage({ promptTokens: 12_000, completionTokens: 345, totalTokens: 12_345 }), {
    label: '12.0K',
    title: '输入 12.0K · 输出 345 · 合计 12.3K tokens',
  });
});

test('token usage tooltip supports English without changing values', () => {
  assert.deepEqual(formatTokenUsage({ promptTokens: 12_000, completionTokens: 345, totalTokens: 12_345 }, 'en-US'), {
    label: '12.0K',
    title: 'Input 12.0K · output 345 · total 12.3K tokens',
  });
  assert.deepEqual(formatTokenUsage(undefined, 'en-US'), { label: '--', title: 'Latest usage unavailable' });
});
