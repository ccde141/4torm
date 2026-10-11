import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneAgentDispatchService } from '../application/agent-dispatch-service.js';
import { cycloneAgentDispatchHandlers, cycloneAgentDispatchManifests } from './agent-dispatch-methods.js';

test('Agent 派发工具只允许分页查、分段读与带入，不允许忽略', async () => {
  const names = cycloneAgentDispatchManifests().map(method => method.agentTool?.name);
  assert.deepEqual(names, ['list_collaboration_dispatches',
    'read_collaboration_dispatch', 'include_collaboration_dispatch']);
  let action: unknown;
  const service = { include: async (...args: unknown[]) => { action = args; return { id: 'd-a' }; } };
  const handlers = cycloneAgentDispatchHandlers(service as unknown as CycloneAgentDispatchService);
  assert.throws(() => handlers.includeCollaborationDispatch.parse({
    workshopId: 'cyc-a', roomId: 'room-a', dispatchId: 'd-a', action: 'dismiss',
  }));
  assert.throws(() => handlers.readCollaborationDispatch.parse({
    workshopId: 'cyc-a', dispatchId: 'd-a', part: 'all',
  }));
  const input = handlers.includeCollaborationDispatch.parse({
    workshopId: 'cyc-a', roomId: 'room-a', dispatchId: 'd-a',
  });
  await handlers.includeCollaborationDispatch.invoke({} as never, input);
  assert.deepEqual(action, ['cyc-a', 'room-a', 'd-a']);
});
