import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneRoomService } from '../application/room-service.js';
import {
  createCycloneRoomIntroductionPort,
  type CycloneRoomIntroductionRuntime,
} from './room-introduction-adapter.js';

test('入会介绍失败后释放工位活动与锁并保存 failed 终态', async () => {
  const finishes: unknown[] = [];
  let activityFinished = 0;
  let lockReleased = 0;
  const commands = {
    begin: async input => ({ ...input, operationId: 'room:cyc-1:room-1',
      runId: 'run-1', startedAt: 'now' }),
    finish: async input => { finishes.push(input); return { ...input, finished: true as const }; },
  } as CycloneCommands;
  const rooms = { require: async () => ({ id: 'room-1', title: '大厅', topic: '发布',
    participantSeatIds: [], publicMessages: [] }) } as unknown as CycloneRoomService;
  const runtime: CycloneRoomIntroductionRuntime = {
    loadSeat: async () => ({ title: '评审', agentId: 'agent-reviewer' }),
    acquireSeat: () => () => { lockReleased += 1; },
    beginActivity: () => ({ finish: () => { activityFinished += 1; } }),
    generate: async () => { throw new Error('model failed'); },
  };
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneRoomIntroductionPort('data', rooms, commands, executions, runtime);

  const prepared = await port.prepare({ workshopId: 'cyc-1', roomId: 'room-1',
    intros: [{ seatId: 'seat-1', behavior: 'summary' }] });
  await assert.rejects(() => prepared.run(), /model failed/);
  assert.equal(activityFinished, 1);
  assert.equal(lockReleased, 1);
  assert.deepEqual(finishes, [{ operationId: 'room:cyc-1:room-1', runId: 'run-1',
    status: 'failed', agentIds: ['agent-reviewer'], error: 'model failed' }]);
});

test('入会介绍模型调用的用量写入公聊事件流', async () => {
  const events: unknown[] = [];
  const room = { id: 'room-1', title: '大厅', topic: '发布', participantSeatIds: [],
    publicMessages: [], createdAt: '', updatedAt: '' };
  const commands = {
    begin: async () => ({ operationId: 'room:cyc-1:room-1', runId: 'run-1', startedAt: 'now' }),
    finish: async () => ({}),
  } as unknown as CycloneCommands;
  const rooms = { require: async () => room } as unknown as CycloneRoomService;
  const runtime: CycloneRoomIntroductionRuntime = {
    loadSeat: async () => ({ title: '评审', agentId: 'agent-reviewer' }),
    acquireSeat: () => () => {}, beginActivity: () => ({ finish: () => {} }),
    generate: async (_dataDir, _workshopId, _room, _seatId, _behavior, _chunk,
      _signal, onUsage) => {
      onUsage?.({ promptTokens: 640, completionTokens: 20, totalTokens: 660 });
      return '我来评审';
    },
  };
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneRoomIntroductionPort('data', rooms, commands, executions, runtime);
  const prepared = await port.prepare({ workshopId: 'cyc-1', roomId: 'room-1',
    intros: [{ seatId: 'seat-1', behavior: 'intro' }] });
  await prepared.run(event => events.push(event));
  assert.deepEqual(events.filter(event => (event as { type?: string }).type === 'usage'), [
    { type: 'usage', usage: { promptTokens: 640, completionTokens: 20, totalTokens: 660 } },
  ]);
});
