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
  assert.deepEqual(formatTokenUsage(undefined), { label: '--', title: '尚无模型返回的实际用量' });
  assert.deepEqual(formatTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 9000 }), {
    label: '9.0K',
    title: '历史实际总量 9.0K tokens；输入/输出明细将在下次回复后补齐',
  });
  assert.deepEqual(formatTokenUsage({ promptTokens: 12_000, completionTokens: 345, totalTokens: 12_345 }), {
    label: '12.3K',
    title: '实际用量：输入 12.0K + 输出 345 = 12.3K tokens',
  });
});
