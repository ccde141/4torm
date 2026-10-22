import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorkshop } from './workshop-store.js';
import { addSeat, loadSeat, tryAcquireSeatLock } from './seat-store.js';
import { execContactOutcome, persistContactMessage } from './contact.js';
import { drainCycloneContacts, readContactCommunication, readContactCommunicationOutcome,
  recoverCycloneContacts, runContactCommunication, shutdownCycloneContacts,
  subscribeContactCommunications,
  type ContactEndpoint } from './contact-communication.js';
import { createContactCommunication, mutateContactCommunication } from './contact-communication-store.js';

test('联络入站消息先落盘，目标工位可在回复前看到人类侧气泡', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-contact-inbound-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir);
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '执行工位' });
  seat.compaction = { type: 'compact-start', id: 'interrupted', operation: 'compact',
    startedAt: 1, updatedAt: 1, reason: 'manual' };

  await persistContactMessage(dataDir, workshop.id, seat, '分析工位', '请检查这份资料');

  const saved = await loadSeat(dataDir, workshop.id, seat.id);
  assert.equal(saved?.messages[0]?.role, 'user');
  assert.match(saved?.messages[0]?.content || '', /来自工位「分析工位」的联络/);
  assert.match(saved?.messages[0]?.content || '', /请检查这份资料/);
  assert.equal(saved?.compaction, undefined);
});

async function communicationFixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-contact-window-'));
  t.after(async () => { await shutdownCycloneContacts(dataDir); await fs.rm(dataDir, { recursive: true, force: true }); });
  const workshop = await createWorkshop(dataDir);
  const source = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '来源' });
  const target = await addSeat(dataDir, workshop.id, { agentId: 'agent-b', title: '目标' });
  const input = { dataDir, workshopId: workshop.id, fromSeatId: source.id, fromTitle: source.title };
  return { dataDir, workshop, source, target, input };
}

test('contact接入窗口耗尽返回busy且不写目标上下文，释放忙线后也不迟到投递', async t => {
  const { dataDir, workshop, source, target } = await communicationFixture(t);
  const release = tryAcquireSeatLock(workshop.id, target.id); assert.ok(release);
  const outcome = await execContactOutcome({ dataDir, workshopId: workshop.id,
    fromSeatId: source.id, fromTitle: source.title, depth: 0 }, target.title, '不应送达',
  { admissionMs: 20, pollMs: 2, replyMs: 20 });
  const result = JSON.parse(outcome.result);
  assert.equal(outcome.ok, false);
  assert.equal(result.status, 'busy'); assert.equal(result.delivered, false);
  release(); await drainCycloneContacts();
  assert.deepEqual((await loadSeat(dataDir, workshop.id, target.id))?.messages, []);
  assert.equal((await readContactCommunication(dataDir, workshop.id, result.contactId))?.status, 'busy');
});

test('contact已接入超过回复窗口后返回可查询running，接收方继续一次执行并保存回报', async t => {
  const { dataDir, workshop, target, input } = await communicationFixture(t);
  const notifications: Promise<void>[] = [];
  const seen: string[] = [];
  const unsubscribeBroken = subscribeContactCommunications(dataDir, () => { throw new Error('通知消费者已断开'); });
  const unsubscribe = subscribeContactCommunications(path.join(dataDir, '.'), item => {
    seen.push(item.status);
    notifications.push(readContactCommunication(dataDir, item.workshopId, item.id).then(saved => {
      assert.equal(saved?.id, item.id);
    }));
    item.response = '通知不能改写存储';
  });
  t.after(() => { unsubscribe(); unsubscribeBroken(); });
  let resolveReply!: () => void;
  const reply = new Promise<void>(resolve => { resolveReply = resolve; });
  let calls = 0; let released = 0;
  const endpoint: ContactEndpoint = { id: target.id, title: target.title, kind: 'seat',
    tryAcquire: async () => () => { released++; },
    execute: async () => { calls++; await reply; return { result: '真实回报', ok: true }; },
  };
  const outcome = await runContactCommunication(input, endpoint, { admissionMs: 100, replyMs: 5 });
  const accepted = JSON.parse(outcome.result);
  assert.equal(accepted.status, 'running'); assert.equal(accepted.delivered, true);
  assert.equal(released, 0); assert.equal(calls, 1);
  const query = await readContactCommunicationOutcome(input, { contactId: accepted.contactId });
  assert.equal(JSON.parse(query.result).status, 'running');
  resolveReply(); await drainCycloneContacts();
  const finished = await readContactCommunication(dataDir, workshop.id, accepted.contactId);
  assert.equal(finished?.status, 'completed'); assert.equal(finished?.response, '真实回报');
  assert.equal(released, 1); assert.equal(calls, 1);
  await Promise.all(notifications);
  assert.deepEqual(seen, ['waiting', 'running', 'completed']);
  unsubscribe();
  await mutateContactCommunication(dataDir, workshop.id, accepted.contactId, item => ({ ...item, updatedAt: new Date().toISOString() }));
  assert.equal(seen.length, 3);
});

test('contact默认目标执行链脱离等待后仍保存原收件箱、工具锁与最终正文', async t => {
  const { dataDir, workshop, source, target } = await communicationFixture(t);
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-b': { model: 'test:model', config: { toolMode: 'selected', tools: [] } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'test', baseUrl: 'https://contact.test/v1', models: ['model'], nativeMode: 'text',
  }] }));
  let begin!: () => void; let finish!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  t.mock.method(globalThis, 'fetch', async () => {
    begin(); await gate;
    return new Response('data: {"choices":[{"delta":{"content":"真实收件箱回报"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const pending = execContactOutcome({ dataDir, workshopId: workshop.id, fromSeatId: source.id,
    fromTitle: source.title, depth: 0 }, target.title, '需要持续执行的联络', { admissionMs: 1000, replyMs: 10 });
  await started;
  const accepted = JSON.parse((await pending).result);
  assert.equal(accepted.status, 'running'); assert.equal(accepted.delivered, true);
  assert.match((await loadSeat(dataDir, workshop.id, target.id))?.messages[0].content ?? '', /需要持续执行的联络/);
  assert.equal(tryAcquireSeatLock(workshop.id, target.id), null);
  finish(); await drainCycloneContacts();
  assert.equal((await loadSeat(dataDir, workshop.id, target.id))?.messages.at(-1)?.content, '真实收件箱回报');
  assert.equal((await readContactCommunication(dataDir, workshop.id, accepted.contactId))?.status, 'completed');
  const release = tryAcquireSeatLock(workshop.id, target.id); assert.ok(release); release();
});

test('contact接入前调用方取消撤回，接入后取消只停止等待而不伪报未送达', async t => {
  const { target, input } = await communicationFixture(t);
  const early = new AbortController(); early.abort();
  let attempts = 0;
  const notDelivered = await runContactCommunication({ ...input, signal: early.signal }, {
    id: target.id, title: target.title, kind: 'seat', tryAcquire: async () => { attempts++; return null; },
    execute: async () => { assert.fail('未接入请求不能执行'); },
  }, { admissionMs: 20, pollMs: 2 });
  assert.equal(JSON.parse(notDelivered.result).status, 'aborted');
  assert.equal(JSON.parse(notDelivered.result).delivered, false); assert.equal(attempts, 0);
  const late = new AbortController(); let started!: () => void; let finish!: () => void;
  const accepted = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let receiverSignal: AbortSignal | undefined;
  const pending = runContactCommunication({ ...input, signal: late.signal }, {
    id: target.id, title: target.title, kind: 'seat', tryAcquire: async () => () => {},
    execute: async signal => { receiverSignal = signal; started(); await gate; return { result: '已完成', ok: true }; },
  }, { admissionMs: 100, replyMs: 1000 });
  await accepted; late.abort();
  const detached = JSON.parse((await pending).result);
  assert.equal(detached.status, 'running'); assert.equal(detached.delivered, true);
  assert.equal(receiverSignal?.aborted, false);
  finish(); await drainCycloneContacts();
});

test('contact迟于接入期限拿到锁也必须释放，不运行接收方', async t => {
  const { target, input } = await communicationFixture(t);
  let released = false;
  const outcome = await runContactCommunication(input, {
    id: target.id, title: target.title, kind: 'seat',
    tryAcquire: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return () => { released = true; }; },
    execute: async () => { assert.fail('过期请求不得运行'); },
  }, { admissionMs: 10 });
  assert.equal(JSON.parse(outcome.result).status, 'busy'); assert.equal(released, true);
});

test('contact查询范围由源或接收岗位绑定，长回复转义后仍可分段完整续读', async t => {
  const { target, input } = await communicationFixture(t);
  const content = '\u0000'.repeat(7000);
  const outcome = await runContactCommunication(input, {
    id: target.id, title: target.title, kind: 'seat', tryAcquire: async () => () => {},
    execute: async () => ({ result: content, ok: true }),
  });
  const id = JSON.parse(outcome.result).contactId;
  assert.equal((await readContactCommunicationOutcome({ ...input, fromSeatId: 'stranger' }, { contactId: id })).ok, false);
  assert.equal((await readContactCommunicationOutcome({ ...input, sourceKind: 'supervisor' }, { contactId: id })).ok, false);
  assert.equal((await readContactCommunicationOutcome(input, { contactId: id, workshopId: 'other' })).ok, false);
  let offset = 0; let actual = '';
  do {
    const page = await readContactCommunicationOutcome(input, { contactId: id, offset: String(offset) });
    assert.equal(page.ok, true); assert.ok(page.result.length <= 18_000);
    const parsed = JSON.parse(page.result); actual += parsed.response;
    if (parsed.nextOffset === undefined) break;
    assert.ok(parsed.nextOffset > offset); offset = parsed.nextOffset;
  } while (true);
  assert.equal(actual, content);
});

test('contact重启恢复未送达为撤回、已送达为crashed，不重放任何请求', async t => {
  const { dataDir, workshop, source, target } = await communicationFixture(t);
  const input = { workshopId: workshop.id, sourceId: source.id, sourceKind: 'seat' as const,
    sourceTitle: source.title, targetId: target.id, targetKind: 'seat' as const, targetTitle: target.title,
    admissionDeadlineAt: new Date(Date.now() + 10000).toISOString() };
  const waiting = await createContactCommunication(dataDir, input);
  const running = await createContactCommunication(dataDir, input);
  await mutateContactCommunication(dataDir, workshop.id, running.id, current => ({
    ...current, delivered: true, status: 'running', acceptedAt: new Date().toISOString(),
  }));
  assert.equal(await recoverCycloneContacts(dataDir), 2);
  assert.equal((await readContactCommunication(dataDir, workshop.id, waiting.id))?.status, 'busy');
  const record = await readContactCommunication(dataDir, workshop.id, running.id);
  assert.equal(record?.status, 'crashed'); assert.equal(record?.delivered, true);
  assert.equal(await recoverCycloneContacts(dataDir), 0);
});
