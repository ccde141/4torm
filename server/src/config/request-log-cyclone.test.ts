import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldLogRequest } from './request-log-policy.js';

test('气旋工位版本轮询成功时静默，失败时保留日志', () => {
  const url = '/api/cyclone/workshop/cyc-a/seat/seat-b/revision';
  assert.equal(shouldLogRequest('GET', url, 200), false);
  assert.equal(shouldLogRequest('GET', url, 500), true);
});
