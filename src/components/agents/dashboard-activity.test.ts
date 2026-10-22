import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../../types';
import type { CollaborationSnapshot } from '../../api/collaboration';
import { projectAgentActivity } from './dashboard-activity.js';

const agent = { id: 'agent-a', name: 'A', status: 'idle', busy: false } as Agent;
const probe = { operationId: 'session-1', runId: 'run-1', agentId: 'agent-a',
  title: '核对材料', status: 'running' as const, updatedAt: '2026-10-01T08:00:00Z' };
const snapshot = (items: unknown[], partial = false): CollaborationSnapshot => ({
  schemaVersion: 1, revision: 'r1', observedAt: '2026-10-01T08:00:00Z',
  completeness: partial ? 'partial' : 'complete',
  features: [{ id: 'monsoon', version: 1, title: '季风', methods: [], observation: {
    schemaVersion: 1, feature: 'monsoon', view: 'summary', revision: 'r1',
    observedAt: '2026-10-01T08:00:00Z', completeness: 'complete',
    items: items as typeof probe[], truncated: false,
  } }],
});

test('只把明确携带 agentId 的运行归于该 Agent', () => {
  const state = projectAgentActivity({ ...agent, busy: true }, true, snapshot([
    { ...probe, agentId: undefined, title: '不能推断归属' }, probe,
  ]), false);
  assert.equal(state.kind, 'running');
  assert.equal(state.item?.title, '核对材料');
  assert.equal(state.feature, 'monsoon');
});

test('探针或活动信息不完整时，缺少运行事实不等于空闲', () => {
  assert.equal(projectAgentActivity(agent, true, null, false).kind, 'unknown');
  assert.equal(projectAgentActivity(agent, false, snapshot([]), false).kind, 'unknown');
  assert.equal(projectAgentActivity(agent, true, snapshot([], true), false).kind, 'unknown');
});

test('活动源知道 Agent 忙但运行未关联时，保留工作中且不伪造标题', () => {
  const state = projectAgentActivity({ ...agent, busy: true,
    activeSurfaces: ['cyclone'] }, true, snapshot([]), false);
  assert.equal(state.kind, 'running');
  assert.equal(state.item, undefined);
  assert.equal(state.label, '工作中 · 气旋');
  assert.equal(state.feature, 'cyclone');
  const conversation = projectAgentActivity({ ...agent, busy: true,
    activeSurfaces: ['conversation'] }, true, snapshot([]), false);
  assert.equal(conversation.label, '工作中 · 季风');
  assert.equal(conversation.feature, 'monsoon');
});

test('等待状态、模型不可用和确切空闲分别表达', () => {
  const waiting = projectAgentActivity(agent, true,
    snapshot([{ ...probe, status: 'waiting' }]), false);
  assert.equal(waiting.kind, 'idle');
  assert.equal(waiting.recent?.status, 'waiting');
  assert.equal(projectAgentActivity({ ...agent, busy: true }, true,
    snapshot([{ ...probe, status: 'queued' }]), false).label, '排队中');
  assert.equal(projectAgentActivity(agent, true,
    snapshot([{ ...probe, status: 'running' }]), false).kind, 'unknown');
  assert.equal(projectAgentActivity(agent, true, snapshot([]), true).kind, 'offline');
  assert.equal(projectAgentActivity(agent, true, snapshot([]), false).kind, 'idle');
});

test('空闲时保留最近事项所属功能区，供记录面板精准查找', () => {
  const state = projectAgentActivity(agent, true,
    snapshot([{ ...probe, status: 'completed', title: probe.operationId }]), false);
  assert.equal(state.kind, 'idle');
  assert.equal(state.recentFeature, 'monsoon');
  assert.equal(state.recent?.operationId, 'session-1');
});

test('已计划的潮汐任务不冒充 Agent 刚完成的活动', () => {
  const state = projectAgentActivity(agent, true,
    snapshot([{ ...probe, status: 'idle', title: '五分钟后再运行',
      updatedAt: '2026-10-02T00:00:00Z' }]), false);
  assert.equal(state.kind, 'idle');
  assert.deepEqual(state.events, []);
});

test('Agent 空闲与其事项等待确认分开，保留可追溯的跨功能区活动', () => {
  const fact = snapshot([{ ...probe, status: 'waiting',
    title: '等待发布确认', updatedAt: '2026-10-01T09:00:00Z' }]);
  fact.features.push({ id: 'tide', version: 1, title: '潮汐', methods: [], observation: {
    schemaVersion: 1, feature: 'tide', view: 'summary', revision: 'r1',
    observedAt: fact.observedAt, completeness: 'complete', truncated: false,
    items: [{ ...probe, operationId: 'task-2', status: 'completed',
      title: '完成摘要', updatedAt: '2026-10-01T08:00:00Z' },
      { ...probe, operationId: 'task-3', agentId: undefined,
        title: '不能归属的任务' }],
  } });
  const state = projectAgentActivity(agent, true, fact, false);
  assert.equal(state.kind, 'idle');
  assert.equal(state.recent?.title, '等待发布确认');
  assert.deepEqual(state.events.map(event => event.item.title),
    ['等待发布确认', '完成摘要']);
  assert.equal(state.complete, true);
});

test('探针截断时活动与统计范围明确为不完整', () => {
  const fact = snapshot([{ ...probe, status: 'completed' }]);
  fact.features[0]!.observation!.truncated = true;
  const state = projectAgentActivity(agent, true, fact, false);
  assert.equal(state.kind, 'unknown');
  assert.equal(state.complete, false);
  assert.equal(state.events.length, 1);
});

test('Agent 当前在季风工作时，旧的信风等待事项不能改写当前状态', () => {
  const fact = snapshot([{ ...probe, status: 'running' }]);
  fact.features.push({ id: 'tradewind', version: 1, title: '信风', methods: [], observation: {
    schemaVersion: 1, feature: 'tradewind', view: 'summary', revision: 'r1',
    observedAt: fact.observedAt, completeness: 'complete', truncated: false,
    items: [{ ...probe, operationId: 'old-flow', status: 'waiting',
      title: '旧审核', updatedAt: '2026-10-01T09:00:00Z' }],
  } });
  const state = projectAgentActivity({ ...agent, busy: true,
    activeSurfaces: ['conversation'] }, true, fact, false);
  assert.equal(state.kind, 'running');
  assert.equal(state.item?.title, '核对材料');
});
