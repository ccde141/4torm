import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../types';
import { mergeAgentActivities } from './agent.js';

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
