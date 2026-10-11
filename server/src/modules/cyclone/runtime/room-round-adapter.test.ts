import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneRoomService } from '../application/room-service.js';
import { createCycloneRoomRoundPort } from './room-round-adapter.js';
import { CycloneChangeFeed } from '../application/change-feed.js';

test('群聊 token 不触发刷新，落盘后消息与终态才唤醒', async () => {
  const feed = new CycloneChangeFeed();
  const signals: string[] = [];
  feed.subscribe(item => signals.push(item.scope));
  const commands = { begin: async () => ({ operationId: 'room:cyc-1:room-1',
    runId: 'run-1', startedAt: 'now' }), finish: async () => ({}) } as CycloneCommands;
  const rooms = { require: async () => ({ participantSeatIds: ['seat-a'] }) } as CycloneRoomService;
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneRoomRoundPort('data', rooms, commands, executions,
    async (_data, _wid, _room, _message, emit) => {
      emit({ type: 'token', speaker: '成员', content: '流式内容' });
      emit({ type: 'seat-start', speaker: '成员', agentId: 'agent-a' });
      emit({ type: 'seat-done', speaker: '成员', content: '已落盘' });
    }, feed);
  const prepared = await port.prepare({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' });
  await prepared.run();
  assert.deepEqual(signals, ['activity', 'activity', 'activity', 'activity']);
});

test('房间运行端口在模型失败后写入 failed 并释放中心执行', async () => {
  const finishes: unknown[] = [];
  const commands = {
    begin: async input => ({ ...input, operationId: 'room:cyc-1:room-1',
      runId: 'run-1', startedAt: 'now' }),
    finish: async input => { finishes.push(input); return { ...input, finished: true as const }; },
  } as CycloneCommands;
  const rooms = { require: async () => ({ id: 'room-1', title: '大厅', topic: '发布',
    participantSeatIds: ['seat-a'], publicMessages: [] }) } as unknown as CycloneRoomService;
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneRoomRoundPort(
    'data', rooms, commands, executions,
    async () => { throw new Error('model failed'); },
  );

  const prepared = await port.prepare({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' });
  await assert.rejects(() => prepared.run(), /model failed/);
  assert.deepEqual(finishes, [{
    operationId: 'room:cyc-1:room-1', runId: 'run-1', status: 'failed', error: 'model failed',
  }]);
});

test('群聊记录只归属实际开始发言的工位 Agent', async () => {
  const finishes: unknown[] = [];
  const commands = {
    begin: async input => ({ ...input, operationId: 'room:cyc-1:room-1',
      runId: 'run-1', startedAt: 'now' }),
    finish: async input => { finishes.push(input); return { ...input, finished: true as const }; },
  } as CycloneCommands;
  const rooms = { require: async () => ({ id: 'room-1', title: '大厅', topic: '发布',
    participantSeatIds: ['seat-a', 'seat-b'], publicMessages: [] }) } as unknown as CycloneRoomService;
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneRoomRoundPort('data', rooms, commands, executions,
    async (_data, _wid, _room, _message, emit) => {
      emit({ type: 'seat-start', speaker: '成员 A', turnId: 'turn-a', agentId: 'agent-a' });
    });
  const prepared = await port.prepare({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' });
  await prepared.run();
  assert.deepEqual(finishes, [{ operationId: 'room:cyc-1:room-1', runId: 'run-1',
    status: 'completed', agentIds: ['agent-a'] }]);
});

test('房间运行先获得执行锁再读取房间快照，避免覆盖已提交的成员变更', async () => {
  const order: string[] = [];
  const commands = { begin: async () => {
    order.push('lock');
    return { operationId: 'room:cyc-1:room-1', runId: 'run-1', startedAt: 'now' };
  }, finish: async () => ({}) } as unknown as CycloneCommands;
  const rooms = { require: async () => {
    order.push('read');
    return { participantSeatIds: ['seat-a'], publicMessages: [] };
  } } as unknown as CycloneRoomService;
  const port = createCycloneRoomRoundPort('data', rooms, commands,
    {} as CycloneExecutionPort, async () => {});
  await port.prepare({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' });
  assert.deepEqual(order, ['lock', 'read']);
});

test('执行锁已取得而房间读取失败时写入失败终态并释放锁', async () => {
  const finishes: unknown[] = [];
  const commands = { begin: async () => ({ operationId: 'room:cyc-1:room-1',
    runId: 'run-1', startedAt: 'now' }),
  finish: async (input: unknown) => { finishes.push(input); return input; } } as CycloneCommands;
  const rooms = { require: async () => { throw new Error('room lost'); } } as unknown as CycloneRoomService;
  const port = createCycloneRoomRoundPort('data', rooms, commands,
    {} as CycloneExecutionPort, async () => {});
  await assert.rejects(port.prepare({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' }),
    /room lost/);
  assert.deepEqual(finishes, [{ operationId: 'room:cyc-1:room-1', runId: 'run-1',
    status: 'failed', error: 'room lost' }]);
});

test('锁内读取到无人群聊时拒绝空跑并释放执行状态', async () => {
  const finishes: unknown[] = [];
  const commands = { begin: async () => ({ operationId: 'room:cyc-1:room-1',
    runId: 'run-1', startedAt: 'now' }),
  finish: async (input: unknown) => { finishes.push(input); return input; } } as CycloneCommands;
  const rooms = { require: async () => ({ participantSeatIds: [] }) } as unknown as CycloneRoomService;
  const port = createCycloneRoomRoundPort('data', rooms, commands,
    {} as CycloneExecutionPort, async () => {});
  await assert.rejects(port.prepare({ workshopId: 'cyc-1', roomId: 'room-1', message: '开始' }),
    error => (error as { data?: { code?: string } }).data?.code === 'CYCLONE_ROOM_EMPTY');
  assert.equal((finishes[0] as { status?: string }).status, 'failed');
});
