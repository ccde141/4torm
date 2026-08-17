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
    getAgents: async () => { calls.push('agents'); return agents; },
    getAllSessions: async () => { calls.push('sessions'); return sessions; },
    getOfflineAgentIds: async () => { calls.push('offline'); return new Set(['agent-b']); },
  });

  assert.deepEqual(calls, ['agents', 'sessions', 'offline']);
  assert.equal(snapshot.stats.totalAgents, 3);
  assert.equal(snapshot.stats.onlineAgents, 1);
  assert.equal(snapshot.stats.totalSessions, 1);
  assert.deepEqual([...snapshot.offlineIds], ['agent-b']);
});

test('Dashboard 在会话统计完成前先交付 Agent 核心数据', async () => {
  const agents = [{ id: 'agent-fast', status: 'idle' }] as Agent[];
  let releaseSessions!: (sessions: unknown[]) => void;
  const sessions = new Promise<unknown[]>(resolve => { releaseSessions = resolve; });
  const applied: Agent[][] = [];

  const loading = loadDashboardSnapshot({
    getAgents: async () => agents,
    getAllSessions: () => sessions,
    getOfflineAgentIds: async () => new Set(),
  }, ready => applied.push(ready));

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, [agents]);
  releaseSessions([]);
  await loading;
});
