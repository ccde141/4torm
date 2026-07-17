import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldLogRequest } from './request-log-policy.js';

test('信风自动保存成功时不打印请求日志', () => {
  assert.equal(shouldLogRequest('POST', '/api/tradewind/workflow/save', 200), false);
});

test('信风自动保存失败时仍打印请求日志', () => {
  assert.equal(shouldLogRequest('POST', '/api/tradewind/workflow/save', 500), true);
});

test('其他非高频请求继续打印', () => {
  assert.equal(shouldLogRequest('POST', '/api/tradewind/workflow/run', 200), true);
});
