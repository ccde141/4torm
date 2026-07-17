import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../../types';
import { loadDashboardSnapshot } from './dashboard-data';

test('Dashboard 一次刷新生成完整快照且不重复读取', async () => {
  const agents = [
    { id: 'agent-a', status: 'idle' },
    { id: 'agent-b', status: 'idle' },
  ] as Agent[];
  const sessions = [{ id: 'session-a' }];
  const calls: string[] = [];

  const snapshot = await loadDashboardSnapshot({
    getAgents: async () => { calls.push('agents'); return agents; },
    getAllSessions: async () => { calls.push('sessions'); return sessions; },
    getOfflineAgentIds: async () => { calls.push('offline'); return new Set(['agent-b']); },
  });

  assert.deepEqual(calls, ['agents', 'sessions', 'offline']);
  assert.equal(snapshot.stats.totalAgents, 2);
  assert.equal(snapshot.stats.onlineAgents, 1);
  assert.equal(snapshot.stats.totalSessions, 1);
  assert.deepEqual([...snapshot.offlineIds], ['agent-b']);
});
