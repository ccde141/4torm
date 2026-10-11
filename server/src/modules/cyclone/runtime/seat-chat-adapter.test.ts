import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import { createCycloneSeatChatPort, type CycloneSeatChatRuntime } from './seat-chat-adapter.js';
import { CycloneChangeFeed } from '../application/change-feed.js';

test('私聊 token 不触发刷新，保存后和终态触发', async () => {
  const feed = new CycloneChangeFeed();
  const signals: string[] = [];
  feed.subscribe(item => signals.push(item.scope));
  const commands = { begin: async () => ({ operationId: 'seat:cyc-1:seat-1',
    runId: 'run-1', startedAt: 'now' }), finish: async () => ({}) } as CycloneCommands;
  const seats = { require: async () => ({ id: 'seat-1' }) } as CycloneSeatService;
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const runtime: CycloneSeatChatRuntime = { chat: async (_data, _workshop, _seat, _text, emit) => {
    emit({ type: 'token', content: '流式内容' });
    emit({ type: 'done' });
    return { content: '已落盘' };
  }, resume: async () => ({ content: '' }), completeAwaiting: async () => undefined,
  kick: () => undefined };
  const port = createCycloneSeatChatPort('data', seats, commands, executions, runtime, feed);
  const prepared = await port.prepare({ workshopId: 'cyc-1', seatId: 'seat-1',
    mode: 'chat', text: '开始' });
  await prepared.run();
  assert.deepEqual(signals, ['activity', 'activity', 'activity']);
});

test('工位私聊失败仍保存 failed、唤醒派发队列并释放执行身份', async () => {
  const finishes: unknown[] = [];
  let kicked = 0;
  const commands = {
    begin: async input => ({ ...input, operationId: 'seat:cyc-1:seat-1',
      runId: 'run-1', startedAt: 'now' }),
    finish: async input => { finishes.push(input); return { ...input, finished: true as const }; },
  } as CycloneCommands;
  const seats = Object.create(null) as CycloneSeatService;
  seats.require = async () => ({ id: 'seat-1', pending: null }) as never;
  const runtime: CycloneSeatChatRuntime = {
    chat: async () => { throw new Error('model failed'); },
    resume: async () => { throw new Error('unexpected'); },
    completeAwaiting: async () => undefined,
    kick: () => { kicked += 1; },
  };
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneSeatChatPort('data', seats, commands, executions, runtime);

  const prepared = await port.prepare({ workshopId: 'cyc-1', seatId: 'seat-1',
    mode: 'chat', text: '检查' });
  await assert.rejects(() => prepared.run(), /model failed/);
  assert.equal(kicked, 1);
  assert.deepEqual(finishes, [{ operationId: 'seat:cyc-1:seat-1', runId: 'run-1',
    status: 'failed', error: 'model failed' }]);
});

test('工位恢复完成且不再挂起时结算等待中的派发', async () => {
  let completed = '';
  let reads = 0;
  const seats = Object.create(null) as CycloneSeatService;
  seats.require = async () => ({ id: 'seat-1', pending: ++reads === 1 ? {} : null }) as never;
  const commands = {
    begin: async input => ({ ...input, operationId: 'seat:cyc-1:seat-1',
      runId: 'run-1', startedAt: 'now' }),
    finish: async input => ({ ...input, finished: true as const }),
  } as CycloneCommands;
  const runtime: CycloneSeatChatRuntime = {
    chat: async () => { throw new Error('unexpected'); },
    resume: async () => ({ content: 'resolved' }),
    completeAwaiting: async (_dataDir, _workshopId, _seatId, content) => { completed = content; },
    kick: () => undefined,
  };
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneSeatChatPort('data', seats, commands, executions, runtime);

  const prepared = await port.prepare({ workshopId: 'cyc-1', seatId: 'seat-1',
    mode: 'resume', text: '答案' });
  await prepared.run();
  assert.equal(completed, 'resolved');
});
