import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import { createCycloneSeatChatPort, type CycloneSeatChatRuntime } from './seat-chat-adapter.js';
import { CycloneChangeFeed } from '../application/change-feed.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { reactErrorData, type ReActTermination } from '../../../engine/shared/react/outcome.js';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';
import { addSeat, loadSeat } from '../../../engine/cyclone/seat-store.js';
import { createWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { chatSeatWithinExecution, resumeSeatWithinExecution } from '../../../engine/cyclone/seat-runner.js';

async function seatFixture(textMode: boolean) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-terminal-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  const provider = { id: 'test', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible' as const, transport: 'openai-chat-completions' as const };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
    ...(textMode ? { toolTransports: { model: { status: 'text-required', checkedAt: 'now',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } } : {}),
  }] }));
  const workshop = await createWorkshop(dataDir);
  const source = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '发起工位' });
  return { dataDir, workshop, source };
}

function seatToolSse(textMode: boolean): Response {
  const delta = textMode
    ? { content: JSON.stringify({ type: 'tool_call', name: 'bulletin', arguments: { action: 'add', text: '' } }) }
    : { tool_calls: [{ index: 0, id: 'call_bulletin', type: 'function',
      function: { name: 'bulletin', arguments: '{"action":"add","text":""}' } }] };
  const payload = { choices: [{ delta, finish_reason: textMode ? 'stop' : 'tool_calls' }] };
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } });
}

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
    return { content: '已落盘', termination: { status: 'succeeded' } };
  }, resume: async () => ({ content: '', termination: { status: 'succeeded' } }), completeAwaiting: async () => undefined,
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
    resume: async () => ({ content: 'resolved', termination: { status: 'succeeded' } }),
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

for (const status of ['failed', 'anomaly', 'waiting', 'aborted'] as const) {
  test(`返回 ${status} 终态不结算等待派发，失败通知晚于执行落盘`, async () => {
    const sequence: string[] = [];
    const finishes: unknown[] = [];
    const error = reactErrorData('MODEL_REQUEST_REJECTED', 'provider', 'request budget reached', 'test');
    const termination: ReActTermination = status === 'failed' || status === 'anomaly'
      ? { status, error } : { status };
    const commands = {
      begin: async () => ({ operationId: 'seat:cyc-1:seat-1', runId: 'run-1', startedAt: 'now' }),
      finish: async input => { sequence.push('finish'); finishes.push(input); return input; },
    } as CycloneCommands;
    const seats = { require: async () => ({ id: 'seat-1' }) } as CycloneSeatService;
    const execute: CycloneSeatChatRuntime['resume'] = async (_data, _workshop, _seat, _text, emit) => {
      emit({ type: 'tool-result', tool: 'seat_memory_write', result: 'saved', ok: true });
      if (status === 'failed' || status === 'anomaly') emit({ type: 'error', message: error.message });
      else emit({ type: 'done' });
      return { content: '[错误] request budget reached', termination };
    };
    const runtime: CycloneSeatChatRuntime = { chat: execute, resume: execute,
      completeAwaiting: async () => { sequence.push('settle'); },
      kick: () => { sequence.push('kick'); } };
    const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
    const port = createCycloneSeatChatPort('data', seats, commands, executions, runtime);
    const prepared = await port.prepare({ workshopId: 'cyc-1', seatId: 'seat-1', mode: 'resume', text: '继续' });
    const run = prepared.run(event => sequence.push((event as { type: string }).type));
    if (status === 'failed' || status === 'anomaly') {
      await assert.rejects(run, caught => caught instanceof FrameworkError && caught.data === error);
      assert.deepEqual(sequence, ['tool-result', 'finish', 'kick', 'error']);
    } else {
      await run;
      assert.deepEqual(sequence, ['tool-result', 'finish', 'kick', 'done']);
    }
    assert.equal((finishes[0] as { status: string }).status,
      status === 'waiting' ? 'completed' : status === 'aborted' ? 'aborted' : 'failed');
  });
}

for (const textMode of [false, true]) {
  test(`seat ${textMode ? 'text' : 'native'} request failure after a tool commits progress and records failed exactly once`, async t => {
    const { dataDir, workshop, source } = await seatFixture(textMode);
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? seatToolSse(textMode)
      : new Response(JSON.stringify({ error: { message: 'request budget reached' } }), { status: 400 }));
    const finishes: Array<{ status?: string; error?: string }> = [];
    let kicks = 0;
    const commands = {
      begin: async () => ({ operationId: 'seat:fixture', runId: 'fixture-run', startedAt: 'now' }),
      finish: async input => { finishes.push(input); return input; },
    } as CycloneCommands;
    const seats = { require: () => loadSeat(dataDir, workshop.id, source.id) } as CycloneSeatService;
    const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
    const port = createCycloneSeatChatPort(dataDir, seats, commands, executions, {
      chat: chatSeatWithinExecution, resume: resumeSeatWithinExecution,
      completeAwaiting: async () => { assert.fail('failed reply must not settle dispatch'); },
      kick: () => { kicks++; },
    });
    const prepared = await port.prepare({ workshopId: workshop.id, seatId: source.id, mode: 'chat', text: '发布公告' });
    const events: Array<{ type: string; tool?: string }> = [];
    await assert.rejects(prepared.run(event => events.push(event as never)), /request budget reached/);
    const saved = await loadSeat(dataDir, workshop.id, source.id);
    assert.equal(calls, 2);
    assert.ok(saved?.messages.some(message => message.role === 'tool' || message.content.includes('tool_result')));
    assert.ok(!saved?.messages.some(message => message.role === 'assistant' && message.content.startsWith('[错误]')));
    assert.equal(events.filter(event => event.type === 'tool-result').length, 1);
    assert.equal(events.filter(event => event.type === 'error').length, 1);
    assert.ok(!events.some(event => event.type === 'answer' || event.type === 'done'));
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].status, 'failed');
    assert.match(finishes[0].error!, /request budget reached/);
    assert.equal(kicks, 1);
  });
}
