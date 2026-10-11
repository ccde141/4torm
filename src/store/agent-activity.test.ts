import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../types';
import { getAgentsWithActivity, mergeAgentActivities } from './agent.js';

test('runtime activity overrides stale persisted busy without mutating registry data', () => {
  const registry = [
    { id: 'agent-a', status: 'idle', busy: false },
    { id: 'agent-b', status: 'idle', busy: true },
  ] as Agent[];

  const merged = mergeAgentActivities(registry, {
    'agent-a': { busy: true, surfaces: ['conversation', 'tide'] },
  });

  assert.deepEqual(merged.map(agent => ({
    id: agent.id,
    busy: agent.busy,
    activeSurfaces: agent.activeSurfaces,
  })), [
    { id: 'agent-a', busy: true, activeSurfaces: ['conversation', 'tide'] },
    { id: 'agent-b', busy: false, activeSurfaces: [] },
  ]);
  assert.equal(registry[1].busy, true);
});

test('活动接口失败时控制台明确返回不可用，不把旧 busy 状态改为空闲', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).endsWith('/presence')
    ? new Response('failed', { status: 503 })
    : Response.json([{ id: 'agent-a', status: 'idle', busy: true, updatedAt: '2026-10-01' }]);
  try {
    const result = await getAgentsWithActivity();
    assert.equal(result.activityAvailable, false);
    assert.equal(result.agents[0]?.busy, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('活动接口返回非映射值时也不声称状态可用', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).endsWith('/presence')
    ? Response.json({ schemaVersion: 1, observedAt: '2026-10-01T00:00:00Z',
      completeness: 'partial', agents: {} })
    : Response.json([{ id: 'agent-a', status: 'idle', busy: true, updatedAt: '2026-10-01' }]);
  try {
    const result = await getAgentsWithActivity();
    assert.equal(result.activityAvailable, false);
    assert.equal(result.agents[0]?.busy, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('完整 Presence 快照才覆盖持久化的旧 busy 状态', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).endsWith('/presence')
    ? Response.json({ schemaVersion: 1, observedAt: '2026-10-01T00:00:00Z',
      completeness: 'complete', agents: {
        'agent-a': { busy: true, surfaces: ['tide'] },
      } })
    : Response.json([
      { id: 'agent-a', status: 'idle', busy: false, updatedAt: '2026-10-01' },
      { id: 'agent-b', status: 'idle', busy: true, updatedAt: '2026-10-01' },
    ]);
  try {
    const result = await getAgentsWithActivity();
    assert.equal(result.activityAvailable, true);
    assert.equal(result.agents.find(agent => agent.id === 'agent-a')?.busy, true);
    assert.equal(result.agents.find(agent => agent.id === 'agent-b')?.busy, false);
  } finally { globalThis.fetch = originalFetch; }
});
