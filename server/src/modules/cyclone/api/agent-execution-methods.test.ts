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
  assert.throws(() => seat.parse({ seatId: 'seat-a', text: '继续' }), /workshopId/);
  assert.throws(() => seat.parse({ workshopId: 'cyc-a', text: '继续' }), /seatId/);
  assert.throws(() => seat.parse({ workshopId: 'cyc-a', seatId: 'seat-a' }), /text/);
  assert.throws(() => seat.parse({ workshopId: 'cyc-a', seatId: 'seat-a', message: '继续' }), /交办内容使用 text/);
  assert.throws(() => seat.parse({ workshopId: 'cyc-a', seatId: '../seat', text: '继续' }), /seatId/);
  const chair = cycloneAgentExecutionHandlers(service as never).startCollaborationChairChat!;
  assert.throws(() => chair.parse({ workshopId: 'cyc-a', message: '继续' }), /roomId/);
  assert.throws(() => chair.parse({ workshopId: 'cyc-a', roomId: 'room-a' }), /message/);
  assert.throws(() => chair.parse({ workshopId: 'cyc-a', roomId: 'room-a', text: '继续' }), /交办内容使用 message/);
  assert.deepEqual(chair.parse({ workshopId: 'cyc-a', roomId: 'room-a', message: '  继续  ' }),
    { workshopId: 'cyc-a', roomId: 'room-a', message: '继续' });
  assert.match(manifests[0].agentTool!.description, /text/);
  assert.match(manifests[1].agentTool!.description, /message/);
});
