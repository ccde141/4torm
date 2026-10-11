import assert from 'node:assert/strict';
import test from 'node:test';
import { cycloneAgentExecutionHandlers, cycloneAgentExecutionManifests } from './agent-execution-methods.js';

test('Agent 执行清单只有普通工位私聊与会长私聊，不开放 resume 和压缩', () => {
  const manifests = cycloneAgentExecutionManifests();
  assert.deepEqual(manifests.map(item => item.agentTool?.name), [
    'start_collaboration_seat_chat', 'start_collaboration_chair_chat',
  ]);
  assert.ok(manifests.every(item => item.audiences.includes('agent')
    && item.output.mode === 'operation'));
  const service = { startSeat: async () => ({}), startChair: async () => ({}) };
  const seat = cycloneAgentExecutionHandlers(service as never).startCollaborationSeatChat;
  assert.ok(seat);
  assert.throws(() => seat.parse({ workshopId: 'cyc-a', seatId: 'seat-a',
    text: '继续', mode: 'resume' }));
  assert.deepEqual(seat.parse({ workshopId: 'cyc-a', seatId: 'seat-a', text: '继续' }),
    { workshopId: 'cyc-a', seatId: 'seat-a', text: '继续' });
});
