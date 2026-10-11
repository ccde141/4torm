import assert from 'node:assert/strict';
import test from 'node:test';
import { CycloneAgentExecutionService } from './agent-execution.js';

const execution = { workshopId: 'cyc-a', targetKind: 'seat' as const, targetId: 'seat-a',
  phase: 'seat-chat' as const, operationId: 'seat:cyc-a:seat-a', runId: 'run-a', startedAt: 'now' };

test('Agent 工位私聊只启动普通 chat，pending 时不创建运行', async () => {
  let prepared = 0;
  const seatChats = { prepare: async (input: unknown) => {
    prepared += 1;
    assert.deepEqual(input, { workshopId: 'cyc-a', seatId: 'seat-a', mode: 'chat', text: '继续调查' });
    return { execution, run: async () => {} };
  } };
  const seats = { require: async () => ({ pending: { prompt: '需要人类回答' } }) };
  const service = new CycloneAgentExecutionService(seatChats as never, {} as never, seats as never);
  await assert.rejects(service.startSeat('cyc-a', 'seat-a', '继续调查'), error =>
    (error as { data?: { code?: string } }).data?.code === 'CYCLONE_SEAT_NEEDS_HUMAN');
  assert.equal(prepared, 0);
  (seats.require as () => Promise<unknown>) = async () => ({ pending: undefined });
  assert.equal((await service.startSeat('cyc-a', 'seat-a', '继续调查')).runId, 'run-a');
  assert.equal(prepared, 1);
});

test('Agent 会长私聊立即返回句柄，后台故障交由真实运行记录与报告口承接', async () => {
  let report!: (error: unknown) => void;
  const reported = new Promise<unknown>(resolve => { report = resolve; });
  const chair = { prepare: async () => ({ execution: { ...execution, targetKind: 'room',
    targetId: 'room-a', phase: 'chair-chat' },
    run: async () => { throw new Error('model failed'); } }) };
  const service = new CycloneAgentExecutionService({} as never, chair as never,
    {} as never, report);
  const receipt = await service.startChair('cyc-a', 'room-a', '请总结进展');
  assert.equal(receipt.runId, 'run-a');
  assert.match(String(await reported), /model failed/);
});

test('Agent 私聊流式事件进入外部活动口，运行结束后准确收口', async () => {
  let settle!: () => void;
  const pending = new Promise<void>(resolve => { settle = resolve; });
  const events: unknown[] = [];
  let finished = 0;
  const activity = { begin: () => ({ emit: (event: unknown) => events.push(event),
    finish: () => { finished += 1; } }) };
  const seatChats = { prepare: async () => ({ execution,
    run: async (emit: (event: unknown) => void) => {
      emit({ type: 'chunk', content: '正在检查' });
      await pending;
    } }) };
  const service = new CycloneAgentExecutionService(seatChats as never, {} as never,
    { require: async () => ({ pending: undefined }) } as never, () => {}, activity as never);
  await service.startSeat('cyc-a', 'seat-a', '检查');
  assert.deepEqual(events, [{ type: 'chunk', content: '正在检查' }]);
  assert.equal(finished, 0);
  settle();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, 1);
});
