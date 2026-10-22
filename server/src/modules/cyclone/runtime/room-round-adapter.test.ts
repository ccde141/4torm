import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneRoomService } from '../application/room-service.js';
import { createCycloneRoomRoundPort } from './room-round-adapter.js';
import { CycloneChangeFeed } from '../application/change-feed.js';
import { createWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { addSeat } from '../../../engine/cyclone/seat-store.js';
import { createRoom, loadRoom } from '../../../engine/cyclone/room-store.js';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';

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

for (const textMode of [false, true]) {
  test(`群聊 ${textMode ? 'text' : 'native'} 后续模型失败保留已完成发言，不推进轮次或启动下一工位`, async t => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cyclone-round-terminal-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    await mkdir(path.join(dataDir, 'agents'), { recursive: true });
    await writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
      agent: { id: 'agent', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] } },
    }));
    const provider = { id: 'test', baseUrl: 'https://example.test/v1', models: ['model'],
      providerType: 'openai-compatible' as const, transport: 'openai-chat-completions' as const };
    await writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
      ...(textMode ? { toolTransports: { model: { status: 'text-required', checkedAt: 'now',
        fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } } : {}),
    }] }));
    const workshop = await createWorkshop(dataDir);
    const members = [];
    for (const title of ['已完成成员', '失败成员', '未启动成员']) {
      members.push(await addSeat(dataDir, workshop.id, { title, agentId: 'agent' }));
    }
    const room = await createRoom(dataDir, workshop.id,
      { title: '讨论', participantSeatIds: members.map(seat => seat.id) });
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1
      ? new Response('data: {"choices":[{"delta":{"content":"<answer>已核对资料。</answer>"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } })
      : new Response(JSON.stringify({ error: { message: 'request budget reached' } }), { status: 400 }));
    const finishes: Array<{ status?: string; error?: string }> = [];
    const commands = {
      begin: async () => ({ operationId: 'room:fixture', runId: 'fixture-run', startedAt: 'now' }),
      finish: async input => { finishes.push(input); return input; },
    } as CycloneCommands;
    const rooms = { require: () => loadRoom(dataDir, workshop.id, room.id) } as CycloneRoomService;
    const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
    const port = createCycloneRoomRoundPort(dataDir, rooms, commands, executions);
    const prepared = await port.prepare({ workshopId: workshop.id, roomId: room.id, message: '共同核对' });
    const started: string[] = [];
    await assert.rejects(prepared.run(event => {
      const item = event as { type: string; speaker: string };
      if (item.type === 'seat-start') started.push(item.speaker);
    }), /request budget reached/);
    const saved = await loadRoom(dataDir, workshop.id, room.id);
    assert.equal(calls, 2);
    assert.deepEqual(started, ['已完成成员', '失败成员']);
    assert.ok(saved?.publicMessages.some(message => message.speaker === '已完成成员'));
    assert.ok(saved?.publicMessages.some(message => message.content === '共同核对'));
    assert.ok(!saved?.publicMessages.some(message => message.speaker === '失败成员'));
    assert.equal(saved?.completedRoundSeq ?? 0, 0);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].status, 'failed');
    assert.match(finishes[0].error!, /request budget reached/);
  });
}
