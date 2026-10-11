import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { createTradewindModule } from './module.js';
import type { TradewindCommands } from '../application/execution-commands.js';
import type { TradewindMeetingCommands } from '../application/meeting-commands.js';

test('Agent 通过同一会议命令口管理成员、发话并结会', async () => {
  const calls: string[] = [];
  const meetingCommands: TradewindMeetingCommands = {
    end: async input => { calls.push(`end:${input.executionId}`); return { minutes: '纪要' }; },
    join: async input => { calls.push(`join:${input.participantNodeId}`); return { participants: [] }; },
    leave: async input => { calls.push(`leave:${input.participantNodeId}`); return { participants: [] }; },
    reorder: async input => { calls.push(`order:${input.order.join(',')}`); return { participants: [] }; },
    speak: async input => {
      calls.push(`speak:${input.nodeId}:${input.message}`);
      return { completed: true, nodeId: input.nodeId, runId: 'round-1' };
    },
    messageChair: async input => {
      calls.push(`chair:${input.nodeId}:${input.message}`);
      return { completed: true, nodeId: input.nodeId };
    },
  };
  const router = new CollaborationRouter([createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as TradewindCommands, meetingCommands,
  })]);
  const agent = {
    actor: { type: 'agent' as const, id: 'agent-a', actingAs: 'human' as const },
    audience: 'agent' as const, enabledFeatures: new Set(['tradewind' as const]),
    permissions: new Set(['intervene' as const]), requestId: 'req-1',
  };
  for (const [method, input] of [
    ['joinMeeting', { executionId: 'exec-1', nodeId: 'meeting', participantNodeId: 'reviewer' }],
    ['reorderMeeting', { executionId: 'exec-1', nodeId: 'meeting', order: ['reviewer'] }],
    ['speakMeeting', { executionId: 'exec-1', nodeId: 'meeting', message: '讨论验收' }],
    ['messageMeetingChair', { executionId: 'exec-1', nodeId: 'meeting', message: '归纳分歧' }],
    ['leaveMeeting', { executionId: 'exec-1', nodeId: 'meeting', participantNodeId: 'reviewer' }],
    ['endMeeting', { executionId: 'exec-1', nodeId: 'meeting' }],
  ] as const) await router.invoke({ feature: 'tradewind', method, input }, agent);
  assert.deepEqual(calls, [
    'join:reviewer', 'order:reviewer', 'speak:meeting:讨论验收',
    'chair:meeting:归纳分歧', 'leave:reviewer', 'end:exec-1',
  ]);
});
