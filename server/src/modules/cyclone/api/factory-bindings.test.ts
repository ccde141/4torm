import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { createCycloneFeature } from './factory.js';

const actor = { type: 'human' as const, id: 'human', actingAs: 'human' as const };
const human: CollaborationContext = { actor, audience: 'human',
  enabledFeatures: new Set(['cyclone']), permissions: new Set(['observe']), requestId: 'req-human' };
const agent: CollaborationContext = { actor: { type: 'agent', id: 'agent-a', actingAs: 'human' },
  audience: 'agent', enabledFeatures: new Set(['cyclone']),
  permissions: new Set(['observe', 'execute']), requestId: 'req-agent' };

test('factory binds Agent reads and private chat starts without exposing live activity to Agent', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-bindings-'));
  try {
    const router = new CollaborationRouter([createCycloneFeature({ dataDir }).module]);
    const tools = router.listAgentTools().map(item => item.definition.name);
    assert.ok(tools.includes('list_collaboration_workshops'));
    assert.ok(tools.includes('start_collaboration_seat_chat'));
    assert.ok(tools.includes('start_collaboration_chair_chat'));
    const agentMethods = router.listManifests(agent)[0].methods.map(item => item.id);
    const humanMethods = router.listManifests(human)[0].methods.map(item => item.id);
    assert.equal(agentMethods.includes('readPrivateChatActivity'), false);
    assert.equal(humanMethods.includes('readPrivateChatActivity'), true);
    await assert.rejects(router.invoke({ feature: 'cyclone', method: 'readPrivateChatActivity',
      input: { workshopId: 'w', targetKind: 'seat', targetId: 's', since: 0 } }, agent));
    assert.equal(await router.invoke({ feature: 'cyclone', method: 'readPrivateChatActivity',
      input: { workshopId: 'w', targetKind: 'seat', targetId: 's', since: 0 } }, human), null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
