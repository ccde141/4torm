import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCycloneUsage, visibleCycloneUsage } from './cyclone-token-usage';

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
