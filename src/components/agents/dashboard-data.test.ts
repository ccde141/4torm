import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../../types';
import { loadDashboardSnapshot } from './dashboard-data';

test('Dashboard 一次刷新生成完整快照且不重复读取', async () => {
  const agents = [
    { id: 'agent-a', status: 'idle' },
    { id: 'agent-b', status: 'idle' },
    { id: 'agent-c', status: 'idle', busy: true, activeSurfaces: ['tide'] },
  ] as Agent[];
  const sessions = [{ id: 'session-a' }];
  const calls: string[] = [];

  const snapshot = await loadDashboardSnapshot({
    getAgentsWithActivity: async () => { calls.push('agents'); return { agents, activityAvailable: true }; },
    getAllSessions: async () => { calls.push('sessions'); return sessions; },
    getOfflineAgentIds: async () => { calls.push('offline'); return new Set(['agent-b']); },
  });

  assert.deepEqual(calls, ['agents', 'sessions', 'offline']);
  assert.equal(snapshot.stats.totalAgents, 3);
  assert.equal(snapshot.stats.onlineAgents, 1);
  assert.equal(snapshot.stats.totalSessions, 1);
  assert.equal(snapshot.activityAvailable, true);
  assert.deepEqual([...snapshot.offlineIds], ['agent-b']);
});

test('Dashboard 在会话统计完成前先交付 Agent 核心数据', async () => {
  const agents = [{ id: 'agent-fast', status: 'idle' }] as Agent[];
  let releaseSessions!: (sessions: unknown[]) => void;
  const sessions = new Promise<unknown[]>(resolve => { releaseSessions = resolve; });
  const applied: Array<{ agents: Agent[]; activityAvailable: boolean }> = [];

  const loading = loadDashboardSnapshot({
    getAgentsWithActivity: async () => ({ agents, activityAvailable: true }),
    getAllSessions: () => sessions,
    getOfflineAgentIds: async () => new Set(),
  }, (ready, activityAvailable) => applied.push({ agents: ready, activityAvailable }));

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, [{ agents, activityAvailable: true }]);
  releaseSessions([]);
  await loading;
});

test('活动状态不可用时不把空闲统计为已确认可用', async () => {
  const snapshot = await loadDashboardSnapshot({
    getAgentsWithActivity: async () => ({
      agents: [{ id: 'agent-a', status: 'idle', busy: false }] as Agent[],
      activityAvailable: false,
    }),
    getAllSessions: async () => [],
    getOfflineAgentIds: async () => new Set(),
  });
  assert.equal(snapshot.stats.onlineAgents, 0);
  assert.equal(snapshot.activityAvailable, false);
});
