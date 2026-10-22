import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { loadSeat, saveSeat, tryAcquireSeatLock } from '../engine/cyclone/seat-store.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { cycloneRoutes } from './cyclone.js';
import { installFrameworkErrorHandler } from './error-handler.js';

async function fixture(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-seat-http-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  await app.register(cycloneRoutes, {
    feature, router,
  });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const workshop = await feature.workshops.create({});
  const seat = await feature.workshops.addSeat({
    workshopId: workshop.id, agentId: 'agent-a', title: '旧名称',
  });
  return { app, dataDir, feature, router, workshopId: workshop.id, seatId: seat.id };
}

test('SSE 首帧写入失败会结束已准备的工位执行并释放锁', async t => {
  const { app, feature, workshopId, seatId } = await fixture(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('不得调用模型'); });
  app.addHook('onRequest', async (_request, reply) => {
    const write = reply.raw.write.bind(reply.raw);
    let first = true;
    reply.raw.write = ((...args: Parameters<typeof write>) => {
      if (first) { first = false; throw new Error('injected first-frame IO'); }
      return write(...args);
    }) as typeof reply.raw.write;
  });
  await app.inject({ method: 'POST', url: `/workshop/${workshopId}/seat/${seatId}/chat`, payload: { message: '开始' } });
  assert.equal(calls, 0);
  assert.equal(feature.executions.list().length, 0);
  assert.equal((await feature.runs.latest(`seat:${workshopId}:${seatId}`))?.status, 'failed');
  const release = tryAcquireSeatLock(workshopId, seatId);
  assert.ok(release); release();
});

test('工位 SSE 已通知终态失败后，抛错不重复补 error 或伪造 done', async t => {
  const { app, router, workshopId, seatId } = await fixture(t);
  t.mock.method(router, 'prepareTransport', async () => ({
    dispose: async () => undefined,
    execution: { operationId: 'seat:fixture', runId: 'fixture-run', startedAt: 'now' },
    run: async (emit: (event: unknown) => void) => {
      emit({ type: 'tool-result', tool: 'seat_memory_write', result: 'saved', ok: true });
      emit({ type: 'error', message: 'request budget reached' });
      throw new Error('request budget reached');
    },
  }));
  const response = await app.inject({ method: 'POST',
    url: `/workshop/${workshopId}/seat/${seatId}/chat`, payload: { message: '开始' } });
  assert.equal(response.statusCode, 200);
  const events = response.body.split('\n').filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  assert.equal(events.filter(event => event.type === 'error').length, 1);
  assert.equal(events.filter(event => event.type === 'done').length, 0);
  assert.equal(events.filter(event => event.type === 'tool-result').length, 1);
});

test('真实工位模型拒绝经过 HTTP 后写 failed 并释放执行与工位锁', async t => {
  const { app, dataDir, feature, workshopId, seatId } = await fixture(t);
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-a': { id: 'agent-a', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'test', baseUrl: 'https://example.test/v1', models: ['model'],
    providerType: 'openai-compatible', transport: 'openai-chat-completions',
  }] }));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(JSON.stringify({ error: { message: 'request budget reached' } }), { status: 400 });
  });
  const response = await app.inject({ method: 'POST',
    url: `/workshop/${workshopId}/seat/${seatId}/chat`, payload: { message: '开始检查' } });
  const events = response.body.split('\n').filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  assert.equal(requests, 1);
  assert.equal(events.filter(event => event.type === 'error').length, 1);
  assert.ok(!events.some(event => event.type === 'answer' || event.type === 'done'));
  const records = await feature.runs.history();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'failed');
  assert.match(records[0].error!, /request budget reached/);
  assert.equal(feature.executions.list().length, 0);
  const release = tryAcquireSeatLock(workshopId, seatId);
  assert.ok(release, '失败结束后必须释放工位锁');
  release();
  assert.equal((await loadSeat(dataDir, workshopId, seatId))?.messages[0].content, '开始检查');
});

test('工位 HTTP 只保留读取和流式动作', async t => {
  const { app, dataDir, feature, workshopId, seatId } = await fixture(t);
  assert.equal((await feature.seats.updateRole(workshopId, seatId, {
    title: '验证工位',
  })).title, '验证工位');
  assert.equal((await app.inject({ method: 'POST',
    url: `/workshop/${workshopId}/seat/${seatId}/update-role`,
  })).statusCode, 400);

  const seat = await loadSeat(dataDir, workshopId, seatId);
  assert.ok(seat);
  seat.messages = [{ role: 'user', content: '旧内容' }];
  await saveSeat(dataDir, workshopId, seat);
  const edit = await app.inject({
    method: 'POST', url: `/workshop/${workshopId}/seat/${seatId}/edit-message`,
    payload: { index: 0, content: '新内容' },
  });
  assert.equal(edit.statusCode, 400);
  await feature.seats.editMessage(workshopId, seatId, 0, '新内容');
  assert.equal((await loadSeat(dataDir, workshopId, seatId))?.messages[0].content, '新内容');
});

test('工位缺失与占用冲突返回稳定错误身份', async t => {
  const { app, workshopId } = await fixture(t);
  const missing = await app.inject(`/workshop/${workshopId}/seat/missing/status`);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().errorCode, 'CYCLONE_SEAT_NOT_FOUND');
});

test('工位重置与删除旧 HTTP 入口均退出', async t => {
  const { app, dataDir, feature, workshopId, seatId } = await fixture(t);
  const seat = await loadSeat(dataDir, workshopId, seatId);
  assert.ok(seat);
  seat.messages = [{ role: 'user', content: '准备归档' }];
  await saveSeat(dataDir, workshopId, seat);
  const reset = await app.inject({
    method: 'POST', url: `/workshop/${workshopId}/seat/${seatId}/reset-context`,
    payload: { mode: 'clear' },
  });
  assert.equal(reset.statusCode, 400);
  const result = await feature.seats.reset(workshopId, seatId, { mode: 'clear' });
  assert.equal(result.archivedCount, 1);
  assert.deepEqual((await loadSeat(dataDir, workshopId, seatId))?.messages, []);

  const removed = await app.inject({
    method: 'POST', url: `/workshop/${workshopId}/seat/${seatId}/delete`,
  });
  assert.equal(removed.statusCode, 400);
  await feature.seats.remove(workshopId, seatId);
  const missing = await app.inject(`/workshop/${workshopId}/seat/${seatId}/status`);
  assert.equal(missing.statusCode, 404);
});
