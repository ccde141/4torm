import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleTideOverview } from './tide-overview-scope.js';

test('切换到 B 的首帧不会暴露或点击 A 的旧任务和探针', () => {
  const old = { agentId: 'a', tasks: [{ id: 'task-a' }],
    probes: [{ operationId: 'task-a' }] };
  assert.deepEqual(visibleTideOverview(old, 'b'), { tasks: [], probes: [] });
  assert.deepEqual(visibleTideOverview(old, 'a'), {
    tasks: old.tasks, probes: old.probes,
  });
});
