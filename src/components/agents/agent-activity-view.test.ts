import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentActivityView } from './dashboard-activity.js';
import { activityMetrics, activityPreview, activityIdentity } from './agent-activity-view.js';

const view: AgentActivityView = {
  kind: 'idle', label: '空闲', summary: '当前未观察到执行中的事项',
  source: 'Agent 活动状态', complete: false,
  observedAt: '2026-10-01T09:00:00Z',
  events: [
    { feature: 'tradewind', item: { operationId: 'same', runId: 'r1',
      agentId: 'a', status: 'waiting', title: '发布前审核', updatedAt: '2026-10-01T09:00:00Z' } },
    { feature: 'monsoon', item: { operationId: 'same', runId: 'r2',
      agentId: 'a', status: 'completed', title: 'same', updatedAt: '2026-09-30T09:00:00Z' } },
  ],
};

test('名片从探针事件投影最近动向，不把机器 ID 冒充标题', () => {
  assert.deepEqual(activityPreview(view).map(item => item.title),
    ['发布前审核', undefined]);
  assert.notEqual(activityIdentity(view.events[0]!), activityIdentity(view.events[1]!));
});

test('统计只计算明确归属的可见探针，并保留不完整标记', () => {
  const metrics = activityMetrics(view);
  assert.equal(metrics.visibleItems, 2);
  assert.equal(metrics.complete, false);
  assert.deepEqual(metrics.statuses, { waiting: 1, completed: 1 });
  assert.deepEqual(metrics.features, { tradewind: 1, monsoon: 1 });
  assert.equal(metrics.observedAt, '2026-10-01T09:00:00Z');
});
