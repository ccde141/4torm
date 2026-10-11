import assert from 'node:assert/strict';
import test from 'node:test';
import { MonsoonRunnerAdapter } from './runner-adapter.js';
import type { MonsoonTurnSpec } from './turn-contract.js';

test('the adapter creates a new execution per turn and keeps its team setup bound to that turn', () => {
  const adapter = new MonsoonRunnerAdapter();
  const spec: MonsoonTurnSpec = {
    dataDir: 'unused', sessionId: 'session-a', agentId: 'agent-a', model: 'provider:model',
    temperature: 0.4, toolNames: [], toolMode: 'selected', skillIds: [],
    workspace: 'unused', sandboxLevel: 'project', native: true,
  };
  const first = adapter.create(spec);
  const second = adapter.create(spec);
  assert.notEqual(first, second);
  assert.equal(first.getAgentId(), 'agent-a');
});
