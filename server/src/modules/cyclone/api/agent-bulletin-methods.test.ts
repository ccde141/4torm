import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneAgentBulletinService } from '../application/agent-bulletin-service.js';
import { cycloneAgentBulletinHandlers, cycloneAgentBulletinManifests } from './agent-bulletin-methods.js';

test('Agent 公告工具仅有读取和追加，不接收伪造落款或改写操作', async () => {
  const methods = cycloneAgentBulletinManifests();
  assert.deepEqual(methods.map(method => method.agentTool?.name), [
    'read_collaboration_bulletin', 'post_collaboration_bulletin',
  ]);
  let call: unknown;
  const service = { post: async (...args: unknown[]) => { call = args; return { entry: {} }; } };
  const handlers = cycloneAgentBulletinHandlers(service as unknown as CycloneAgentBulletinService);
  assert.throws(() => handlers.postCollaborationBulletin.parse({
    workshopId: 'cyc-a', text: '进展', author: '人类',
  }));
  assert.throws(() => handlers.postCollaborationBulletin.parse({
    workshopId: 'cyc-a', text: '进展', op: 'remove',
  }));
  const input = handlers.postCollaborationBulletin.parse({ workshopId: 'cyc-a', text: '进展' });
  await handlers.postCollaborationBulletin.invoke({ actor: { type: 'agent', id: 'agent-a' } } as never,
    input);
  assert.deepEqual(call, ['cyc-a', '进展', 'agent-a']);
});
