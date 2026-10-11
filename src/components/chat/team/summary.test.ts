import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTeam } from './summary';
import type { TeamSnapshot } from './types';
test('协作摘要区分运行、回报待处理和完成判断', () => {
  const state: TeamSnapshot = { revision: 1, truncated: false, members: [], reports: [
    { id: 'r', memberId: 'm', task: '', content: '', outcome: 'completed', acknowledged: false },
  ] };
  assert.deepEqual(summarizeTeam(state), { running: 0, pending: 1, members: 0 });
  state.reports[0].acknowledged = true;
  assert.equal(summarizeTeam(state).pending, 0);
  assert.deepEqual(summarizeTeam(null), { running: 0, pending: 0, members: 0 });
});
