import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CycloneCollaborationRoundService,
  type CycloneRoomRoundPort,
} from './collaboration-round.js';
import { CycloneRoomActivity } from './room-activity.js';

test('Agent 启动协作轮次后立即取得句柄，后台失败由真实终态通道接管', async () => {
  let report!: (error: unknown) => void;
  const reported = new Promise<unknown>(resolve => { report = resolve; });
  const port: CycloneRoomRoundPort = {
    prepare: async () => ({
      execution: {
        workshopId: 'cyc-1', targetKind: 'room', targetId: 'room-1', phase: 'room-speak',
        operationId: 'room:cyc-1:room-1', runId: 'run-1', startedAt: 'now',
      },
      run: async () => { throw new Error('model failed'); },
    }),
  };
  const service = new CycloneCollaborationRoundService(port, populatedRoom(), report);

  const receipt = await service.start({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' });
  assert.equal(receipt.runId, 'run-1');
  assert.match(String(await reported), /model failed/);
});

test('Agent room events remain readable until the exact background run settles', async () => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const activity = new CycloneRoomActivity();
  const port: CycloneRoomRoundPort = { prepare: async () => ({
    execution: {
      workshopId: 'cyc-1', targetKind: 'room', targetId: 'room-1', phase: 'room-speak',
      operationId: 'room:cyc-1:room-1', runId: 'run-1', startedAt: 'now',
    },
    run: async onEvent => {
      onEvent?.({ type: 'seat-start', speaker: 'Researcher', turnId: 'turn-1', agentId: 'agent-1' });
      started();
      await pending;
    },
  }) };
  const service = new CycloneCollaborationRoundService(port, populatedRoom(), () => {}, activity);
  await service.start({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' });
  await entered;
  assert.equal(activity.read('cyc-1', 'room-1')?.running, true);
  assert.equal(activity.read('cyc-1', 'room-1')?.events[0]?.event.type, 'seat-start');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(activity.read('cyc-1', 'room-1')?.running, false);
});

test('Agent 不把无人群聊误报为已完成轮次', async () => {
  let prepared = 0;
  const rounds: CycloneRoomRoundPort = { prepare: async () => {
    prepared += 1;
    throw new Error('不应启动');
  } };
  const rooms = { require: async () => ({ participantSeatIds: [] }) };
  const service = new CycloneCollaborationRoundService(rounds, rooms as never, () => {});
  await assert.rejects(service.start({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' }),
    error => (error as { data?: { code?: string } }).data?.code === 'CYCLONE_ROOM_EMPTY');
  assert.equal(prepared, 0);
});

function populatedRoom() {
  return { require: async () => ({ participantSeatIds: ['seat-a'] }) } as never;
}
