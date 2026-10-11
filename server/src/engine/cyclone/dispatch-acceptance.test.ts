import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchAcceptance } from './dispatch-acceptance.js';

test('派发受理回执保留可查询 ID，且不把排队误报为已送达', () => {
  for (const place of ['room', 'seat'] as const) {
    const message = dispatchAcceptance('信息搜集者', 'dispatch-a', place);
    assert.match(message, /已登记/);
    assert.match(message, /任务 ID：dispatch-a/);
    assert.doesNotMatch(message, /已送达|已完成/);
    assert.match(message, /无需等待/);
  }
});
