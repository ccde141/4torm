import assert from 'node:assert/strict';
import test from 'node:test';
import { cycloneAgentReadHandlers, cycloneAgentReadManifests } from './agent-read-methods.js';

test('Agent 读取入口限定为分页名册、工作室、会话和单条消息', () => {
  assert.deepEqual(cycloneAgentReadManifests().map(item => item.agentTool?.name), [
    'list_collaboration_agents', 'list_collaboration_workshops',
    'read_collaboration_thread', 'read_collaboration_message',
  ]);
  const handlers = cycloneAgentReadHandlers({} as never);
  assert.deepEqual(handlers.readCollaborationThread?.parse({ workshopId: 'cyc-a',
    target: 'room', targetId: 'room-a', limit: 24 }),
  { workshopId: 'cyc-a', target: 'room', targetId: 'room-a', limit: 24 });
  assert.throws(() => handlers.readCollaborationThread?.parse({ workshopId: 'cyc-a',
    target: 'room', targetId: 'room-a', limit: 25 }));
  assert.throws(() => handlers.readCollaborationMessage?.parse({ workshopId: 'cyc-a',
    target: 'room', targetId: 'room-a', revision: 'bad', index: 0 }));
});
