import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { createConvectionFeature } from '../modules/convection/public.js';
import { convectionRoutes } from './convection.js';
import { installFrameworkErrorHandler } from './error-handler.js';

async function setup(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-stream-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createConvectionFeature({ dataDir });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'chair-a': { name: '会长' }, 'agent-a': { name: '成员' },
  }));
  const router = new CollaborationRouter([feature.module]);
  await app.register(convectionRoutes, {
    feature, router,
  });
  const session = await feature.sessions.create({
    chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
  });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { app, feature, router, sessionId: session.id };
}

test('对流 SSE 发言必须先通过中心流式调用口', async t => {
  const { app, router, sessionId } = await setup(t);
  const calls: string[] = [];
  router.prepareTransport = async (_feature, portId) => {
    calls.push(portId);
    throw frameworkError({ code: 'TEST_GATE', kind: 'permission',
      message: '中心拒绝', source: 'test', retryable: false });
  };
  const response = await app.inject({ method: 'POST', url: `/session/${sessionId}/speak`,
    payload: { message: '开始讨论' } });
  assert.deepEqual(calls, ['discussionRound']);
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().errorCode, 'TEST_GATE');
});

test('对流 SSE 成功后按序结束并释放轮次身份', async t => {
  const { app, feature, sessionId } = await setup(t);
  feature.executor.speak = async (_session, message, emit) => {
    emit({ type: 'notice', message });
  };
  const response = await app.inject({
    method: 'POST', url: `/session/${sessionId}/speak`, payload: { message: '开始讨论' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(events(response.body).map(event => event.type), ['round-start', 'notice', 'done']);
  assert.equal(feature.rounds.snapshot(sessionId), null);
  assert.equal((await feature.runs.latest(sessionId))?.status, 'completed');
});

test('对流 SSE 执行失败会返回结构化错误并释放轮次身份', async t => {
  const { app, feature, sessionId } = await setup(t);
  feature.executor.speak = async () => {
    throw frameworkError({
      code: 'CONVECTION_TEST_FAILURE', kind: 'provider', message: '测试失败',
      source: 'test.convection', retryable: false,
    });
  };
  const response = await app.inject({
    method: 'POST', url: `/session/${sessionId}/speak`, payload: { message: '开始讨论' },
  });
  const frames = events(response.body);
  assert.deepEqual(frames.map(event => event.type), ['round-start', 'error']);
  assert.equal(frames[1]?.code, 'CONVECTION_TEST_FAILURE');
  assert.equal(feature.rounds.snapshot(sessionId), null);
  assert.equal((await feature.runs.latest(sessionId))?.status, 'failed');
});

for (const setupStage of ['headers', 'heartbeat', 'first-frame'] as const) {
  test(`SSE ${setupStage} IO 失败取消准备轮次，关闭后不遗留锁与 running`, async t => {
    const { app, feature, sessionId } = await setup(t);
    let called = false;
    feature.executor.speak = async () => { called = true; };
    if (setupStage === 'heartbeat') t.mock.method(globalThis, 'setInterval', () => {
      throw new Error('injected heartbeat IO');
    });
    app.addHook('onRequest', async (_request, reply) => {
      if (setupStage === 'headers') {
        const writeHead = reply.raw.writeHead.bind(reply.raw);
        let first = true;
        reply.raw.writeHead = (...args: Parameters<typeof writeHead>) => {
          if (first) { first = false; throw new Error('injected headers IO'); }
          return writeHead(...args);
        };
      } else if (setupStage === 'first-frame') {
        const write = reply.raw.write.bind(reply.raw);
        let first = true;
        reply.raw.write = ((...args: Parameters<typeof write>) => {
          if (first) { first = false; throw new Error('injected first-frame IO'); }
          return write(...args);
        }) as typeof reply.raw.write;
      }
    });
    await app.inject({ method: 'POST', url: `/session/${sessionId}/speak`,
      payload: { message: '不能执行' } }).catch(() => undefined);
    await feature.discussionRounds.shutdown();
    assert.equal(called, false);
    assert.equal(feature.rounds.snapshot(sessionId), null);
    assert.equal((await feature.runs.latest(sessionId))?.status, 'failed');
    await feature.sessions.rename(sessionId, '锁已释放');
  });
}

test('准备句柄可幂等释放，释放后不能执行，shutdown 也处理未 run 的句柄', async t => {
  const { feature, sessionId } = await setup(t);
  const prepared = await feature.discussionRounds.prepare({
    sessionId, round: 'public', message: '准备后关闭',
  });
  await feature.discussionRounds.shutdown();
  assert.equal(feature.rounds.snapshot(sessionId), null);
  assert.equal((await feature.runs.latest(sessionId))?.status, 'aborted');
  await prepared.dispose();
  await prepared.dispose();
  await assert.rejects(prepared.run());
  await feature.sessions.rename(sessionId, '锁已释放');
});

function events(body: string): Array<Record<string, unknown>> {
  return body.split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);
}
