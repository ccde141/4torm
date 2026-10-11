import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneAgentManagementService } from '../application/agent-management-service.js';
import { cycloneAgentManagementHandlers, cycloneAgentManagementManifests } from './agent-management-methods.js';

test('Agent 日常管理入口只暴露建工位、建房及增量入会与离会', () => {
  const tools = cycloneAgentManagementManifests().map(method => method.agentTool?.name);
  assert.deepEqual(tools, [
    'add_collaboration_seat', 'create_collaboration_room',
    'join_collaboration_room', 'leave_collaboration_room',
  ]);
  assert.ok(cycloneAgentManagementManifests().every(method =>
    method.audiences.includes('agent') && method.permission === 'design'));
});

test('Agent 管理输入明确拒绝历史改写、删实体和 Agent 重绑定字段', () => {
  const handlers = cycloneAgentManagementHandlers({} as CycloneAgentManagementService);
  assert.deepEqual(handlers.createCollaborationRoom.parse({
    workshopId: 'cyc-a', title: '讨论', topic: '任务',
  }), { workshopId: 'cyc-a', title: '讨论', topic: '任务', participantSeatIds: [] });
  assert.throws(() => handlers.addCollaborationSeat.parse({
    workshopId: 'cyc-a', agentId: 'agent-a', title: '实现', messages: [],
  }));
  assert.throws(() => handlers.createCollaborationRoom.parse({
    workshopId: 'cyc-a', title: '讨论', topic: '任务', participantSeatIds: 'seat-a',
  }));
});
