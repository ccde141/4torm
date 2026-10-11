import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveToolTransportContract } from '../../model-runtime/config/tool-transport-contract.js';
import { normalizeToolCallResult } from '../shared/react/native-loop.js';
import { runReActLoop } from '../shared/react/text-loop.js';
import { makeToolCaller, type SeatEvent } from './seat-runner.js';
import { makeRoomToolCaller, type RoomEvent } from './room-runner.js';
import { createDispatchStartBuffer } from './dispatch-start-buffer.js';
import { execContactOutcome, forwardContactEvent } from './contact.js';
import { readExternalSeatActivity } from './seat-activity.js';
import { addSeat } from './seat-store.js';
import { createWorkshop } from './workshop-store.js';
import { toSeatProgressEvent } from './loop-event-forwarder.js';

async function contactFixture(textMode: boolean) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-contact-tools-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  const provider = { id: 'test', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible' as const, transport: 'openai-chat-completions' as const };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    ...provider,
    ...(textMode ? { toolTransports: { model: { status: 'text-required', checkedAt: 'now',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } } : {}),
  }] }));
  const workshop = await createWorkshop(dataDir);
  const source = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '发起工位' });
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '目标工位' });
  return { dataDir, workshop, source, target };
}

function toolSse(textMode: boolean, firstCall: boolean): Response {
  const delta = firstCall
    ? textMode
      ? { content: JSON.stringify({ type: 'tool_call', name: 'bulletin', arguments: { action: 'add', text: '' } }) }
      : { tool_calls: [{ index: 0, id: 'call_bulletin', type: 'function',
        function: { name: 'bulletin', arguments: '{"action":"add","text":""}' } }] }
    : { content: '公告未发布。' };
  const payload = { choices: [{ delta, finish_reason: firstCall && !textMode ? 'tool_calls' : 'stop' }] };
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } });
}

test('seat bulletin rejection keeps tool_result and UI event failed exactly once', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const events: SeatEvent[] = [];
  const caller = makeToolCaller({
    dataDir, workshopId: 'ws', seatId: 'seat', seatTitle: '工位',
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', signal: undefined,
    onEvent: event => events.push(event), onToolRegistration: () => {}, onExecution: () => {},
  });

  const outcome = normalizeToolCallResult(await caller.call('bulletin', { action: 'add', text: '' }));
  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /需要非空 text/);
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
});

test('room bulletin rejection preserves the same failed outcome without duplicate event', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-room-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const events: RoomEvent[] = [];
  const caller = makeRoomToolCaller({
    dataDir, workshopId: 'ws', seatId: 'seat', seatTitle: '工位',
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', speaker: '工位', signal: undefined,
    onEvent: event => events.push(event), roomId: 'room', turnId: 'turn', roundSeq: 1,
    contextVersion: 0, dispatchStarts: createDispatchStartBuffer(() => {}),
  });

  const outcome = normalizeToolCallResult(await caller.call('bulletin', { action: 'add', text: '' }));
  assert.equal(outcome.ok, false);
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
});

test('contact depth guard returns typed failure while legacy string result stays readable', async () => {
  const context = {
    dataDir: '', workshopId: 'ws', fromSeatId: 'seat', fromTitle: '工位', depth: 5,
  };
  const outcome = await execContactOutcome(context, '目标', '消息');
  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /^联络失败：/);
});

test('contact propagates a failed ReAct termination without adding UI events', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-contact-termination-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'test', baseUrl: 'https://example.test/v1', models: ['model'], nativeMode: 'text',
  }] }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('upstream unavailable'); });
  const workshop = await createWorkshop(dataDir);
  const source = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '发起工位' });
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent', title: '目标工位' });

  const outcome = await execContactOutcome({
    dataDir, workshopId: workshop.id, fromSeatId: source.id, fromTitle: source.title, depth: 0,
  }, target.title, '请回复');
  const events = readExternalSeatActivity(workshop.id, target.id)?.events.map(item => item.event) ?? [];
  assert.equal(events.filter(event => event.type === 'error').length, 1);
  assert.equal(events.filter(event => event.type === 'answer').length, 1);
  assert.equal(outcome.ok, false);
});

for (const textMode of [false, true]) {
  test(`contact ${textMode ? 'text' : 'native'} tool events appear once with the real failure bit`, async t => {
    const { dataDir, workshop, source, target } = await contactFixture(textMode);
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => toolSse(textMode, ++calls === 1));

    const outcome = await execContactOutcome({
      dataDir, workshopId: workshop.id, fromSeatId: source.id, fromTitle: source.title, depth: 0,
    }, target.title, '请发布公告');
    const events = readExternalSeatActivity(workshop.id, target.id)?.events.map(item => item.event) ?? [];
    assert.equal(outcome.ok, true);
    assert.equal(calls, 2);
    assert.deepEqual(events.filter(event => event.type === 'tool-call').map(event => event.tool), ['bulletin']);
    assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
  });
}

test('seat task board and background lifecycle reject invalid calls with typed status', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-virtual-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const events: SeatEvent[] = [];
  const caller = makeToolCaller({
    dataDir, workshopId: 'ws', seatId: 'seat', seatTitle: '工位',
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', signal: undefined,
    onEvent: event => events.push(event), onToolRegistration: () => {}, onExecution: () => {},
  });

  const board = normalizeToolCallResult(await caller.call('task_board', { action: 'set', tasks: '[]' }));
  const background = normalizeToolCallResult(await caller.call('inspect_execution', {}));
  assert.equal(board.ok, false);
  assert.equal(background.ok, false);
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false, false]);
});

test('contact forwarding preserves the shared text-loop failure bit once', () => {
  const forwarded: Array<Record<string, unknown>> = [];
  forwardContactEvent({ type: 'tool-result', tool: 'bulletin', result: '拒绝', ok: false },
    event => forwarded.push(event));
  assert.deepEqual(forwarded, [{ type: 'tool-result', tool: 'bulletin', result: '拒绝', ok: false }]);
});

test('unregistered MCP tool failure remains failed at the cyclone caller boundary', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-mcp-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const events: SeatEvent[] = [];
  const caller = makeToolCaller({
    dataDir, workshopId: 'ws', seatId: 'seat', seatTitle: '工位',
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', signal: undefined,
    onEvent: event => events.push(event), onToolRegistration: () => {}, onExecution: () => {},
  });

  const outcome = normalizeToolCallResult(await caller.call('mcp:unregistered:lookup', {}));
  assert.equal(outcome.ok, false);
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
});

test('cyclone text loop sends a failed bulletin result to the model without a duplicate UI event', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-text-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const events: SeatEvent[] = [];
  const messages = [{ role: 'user' as const, content: '发布公告' }];
  const responses = [
    '{"type":"tool_call","name":"bulletin","arguments":{"action":"add","text":""}}',
    '公告发布失败。',
  ];
  const caller = makeToolCaller({
    dataDir, workshopId: 'ws', seatId: 'seat', seatTitle: '工位',
    agentId: 'agent', sandboxLevel: 'project', wsDir: '.', signal: undefined,
    onEvent: event => events.push(event), onToolRegistration: () => {}, onExecution: () => {},
  });
  await runReActLoop({
    messages,
    llm: { call: async () => ({ content: responses.shift()!, finishReason: 'stop' }) },
    tools: caller, allowedTools: ['bulletin'],
    onEvent: event => { const progress = toSeatProgressEvent(event); if (progress) events.push(progress); },
  });

  assert.equal(JSON.parse(messages[2].content).ok, false);
  assert.deepEqual(events.filter(event => event.type === 'tool-result').map(event => event.ok), [false]);
});
