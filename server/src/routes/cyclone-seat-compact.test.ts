import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { addSeat, loadSeat, saveSeat, tryAcquireSeatLock } from '../engine/cyclone/seat-store.js';
import { createWorkshop } from '../engine/cyclone/workshop-store.js';
import { cycloneRoutes } from './cyclone.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { installFrameworkErrorHandler } from './error-handler.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-compact-route-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  installFrameworkErrorHandler(app);
  const feature = createCycloneFeature({ dataDir });
  await app.register(cycloneRoutes, {
    prefix: '/api/cyclone', feature, router: new CollaborationRouter([feature.module]),
  });
  t.after(() => app.close());
  const workshop = await createWorkshop(dataDir, { title: '测试' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: '开发' });
  return { app, dataDir, workshop, seat };
}

test('主动压缩短会话不受旧四轮门槛限制，完整归档并以摘要接续', async (t) => {
  const { app, dataDir, workshop, seat } = await fixture(t);
  seat.messages = [
    { role: 'user', content: '一' }, { role: 'assistant', content: '答一' },
    { role: 'user', content: '二' }, { role: 'assistant', content: '答二' },
    { role: 'user', content: '三' },
  ];
  seat.tokenUsage = { promptTokens: 9_000, completionTokens: 1, totalTokens: 9_001 };
  await saveSeat(dataDir, workshop.id, seat);
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-a': { id: 'agent-a', name: '开发', model: 'p:model' },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://compact.test/v1', models: ['model'] },
  ] }));
  const fetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    const chunk = { choices: [{ delta: { content: '任务继续' }, finish_reason: 'stop' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  t.after(() => { globalThis.fetch = fetch; });
  const response = await app.inject({
    method: 'POST', url: `/api/cyclone/workshop/${workshop.id}/seat/${seat.id}/compact`,
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /"archivedCount":5/);
  const saved = await loadSeat(dataDir, workshop.id, seat.id);
  assert.equal(saved?.messages.length, 1);
  assert.match(saved?.messages[0].content || '', /任务继续/);
});

test('工位被占用时滚动压缩不读取旧快照覆盖当前轮次', async (t) => {
  const { app, workshop, seat } = await fixture(t);
  const release = tryAcquireSeatLock(workshop.id, seat.id);
  assert.ok(release);
  t.after(() => release?.());
  const response = await app.inject({
    method: 'POST', url: `/api/cyclone/workshop/${workshop.id}/seat/${seat.id}/compact`,
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().errorCode, 'CYCLONE_EXECUTION_BUSY');
  assert.match(response.json().error, /正在处理/);
});
