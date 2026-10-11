import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentActivityView } from './dashboard-activity.js';
import type { OperationRecordSummary } from '../../api/collaboration.js';
import { mergeAgentRecords, recordNavigation } from './agent-record-view.js';
import { activityPreview } from './agent-activity-view.js';

const activity = { kind: 'idle', label: '空闲', summary: '', source: '',
  events: [], complete: true } as AgentActivityView;
const record = (operationId: string): OperationRecordSummary => ({
  operationId, runId: 'run-a', title: '实际执行', status: 'completed',
  timestamp: '2026-10-01T00:00:00.000Z', agentId: 'agent-a',
});

test('历史运行和实时事项去重，保留可定位的原始记录', () => {
  const item = record('session-a');
  const merged = mergeAgentRecords(activity, [{ feature: 'convection', record: item },
    { feature: 'convection', record: item }]);
  assert.equal(merged.events.length, 1);
  assert.equal(merged.events[0]?.record, item);
});

test('卡片最近动向使用跨功能区最新运行事实', () => {
  const older = { ...record('session-old'), timestamp: '2026-09-30T00:00:00.000Z' };
  const recent = record('conv-new');
  const merged = mergeAgentRecords(activity, [
    { feature: 'monsoon', record: older }, { feature: 'convection', record: recent },
  ]);
  assert.equal(activityPreview(merged, 1)[0]?.record?.operationId, 'conv-new');
});

test('不同功能区的记录定位到各自实体，潮汐追加只能从确认的链接进入季风', () => {
  assert.deepEqual(recordNavigation('convection', record('conv-a')),
    { page: 'convection', targetId: 'conv-a' });
  assert.deepEqual(recordNavigation('cyclone', record('seat:workshop-a:seat-a')),
    { page: 'cyclone', targetId: 'seat:workshop-a:seat-a' });
  assert.deepEqual(recordNavigation('tradewind', record('wf-a')),
    { page: 'tradewind', targetId: 'wf-a' });
  assert.deepEqual(recordNavigation('tide', record('task-a')),
    { page: 'tide', targetId: 'task-a' });
  assert.equal(recordNavigation('tide', record('task-a')).linkedSessionId, undefined);
  assert.equal(recordNavigation('tide', { ...record('task-a'),
    sessionId: 'tide-session-a' }).tideSessionTarget,
    'session:agent-a:tide-session-a');
  assert.equal(recordNavigation('tide', { ...record('task-a'),
    linkedSessionId: 'session-monsoon' }).linkedSessionId, 'session-monsoon');
});
