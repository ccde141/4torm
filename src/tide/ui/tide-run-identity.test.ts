import assert from 'node:assert/strict';
import test from 'node:test';
import { tideRunIdentity } from './tide-run-identity.js';

test('同时间戳的两轮运行按 taskId 和 runId 区分，旧记录仍能显示', () => {
  const base = { taskId: 'task-a', timestamp: '2026-01-01T00:00:00.000Z' };
  assert.notEqual(tideRunIdentity({ ...base, runId: 'run-1' }),
    tideRunIdentity({ ...base, runId: 'run-2' }));
  assert.equal(tideRunIdentity(base), `task-a:${base.timestamp}`);
});
