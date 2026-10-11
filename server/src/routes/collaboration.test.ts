import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { installFrameworkErrorHandler } from './error-handler.js';
import { createCollaborationRuntime } from '../engine/collaboration/runtime.js';
import { collaborationRoutes } from './collaboration.js';
import { tideTasksFile } from '../services/data-paths.js';
import { createTideFeature } from '../modules/tide/public.js';
import { createMonsoonFeature } from '../modules/monsoon/public.js';
import { createTradewindFeature } from '../modules/tradewind/public.js';
import { createConvectionFeature } from '../modules/convection/public.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { createTradewindModule } from '../modules/tradewind/public.js';

async function setup(t: TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-collaboration-http-'));
  await writeTasks(dataDir, [task('task-a', 'A', true), task('task-b', 'B', false)]);
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const tide = createTideFeature({ dataDir });
  await app.register(collaborationRoutes, {
    router: createCollaborationRuntime({
      monsoonModule: createMonsoonFeature({ dataDir }).module, tideModule: tide.module,
      tradewindModule: createTradewindFeature({ dataDir }).module,
      convectionModule: createConvectionFeature({ dataDir }).module,
      cycloneModule: createCycloneFeature({ dataDir }).module,
    }),
  });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return app;
}

test('collaboration HTTP exposes manifests and invokes the same bounded Tide module', async (t) => {
  const app = await setup(t);
  const manifests = await app.inject({ method: 'GET', url: '/modules' });
  assert.equal(manifests.statusCode, 200);
  const modules = manifests.json();
  assert.deepEqual(modules.find((item: { id: string }) => item.id === 'tide').methods
    .map((method: { id: string }) => method.id), [
      'readTaskList', 'readTaskDetail', 'readTaskRuns', 'readSessions', 'readSession',
      'listTasks', 'createTask', 'updateTask', 'toggleTask', 'deleteTask', 'deleteSession', 'runTask', 'compactSession',
    ]);
  assert.ok(modules.find((item: { id: string }) => item.id === 'monsoon').observation);
  assert.ok(modules.find((item: { id: string }) => item.id === 'convection').observation);
  assert.ok(modules.find((item: { id: string }) => item.id === 'cyclone').observation);
  assert.equal(JSON.stringify(manifests.json()).includes('handlers'), false);

  const response = await app.inject({
    method: 'POST', url: '/invoke',
    payload: { feature: 'tide', method: 'listTasks', input: {}, budget: { items: 1 } },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 1);
  assert.equal(response.json().items[0].status, 'idle');
  assert.equal(JSON.stringify(response.json()).includes('private prompt'), false);

  const observed = await app.inject({
    method: 'POST', url: '/observe',
    payload: { feature: 'tide', query: { view: 'summary', limit: 1 } },
  });
  assert.equal(observed.statusCode, 200);
  assert.equal(observed.json().schemaVersion, 1);
  assert.equal(observed.json().feature, 'tide');
  assert.equal(observed.json().items.length, 1);
  assert.equal(JSON.stringify(observed.json()).includes('private prompt'), false);
});

test('HTTP probe vocabulary and projections preserve visibility, zero values and truncation', async (t) => {
  const app = await setup(t);
  const catalog = await app.inject({ method: 'GET', url: '/probe-fields' });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json().schemaVersion, 1);
  assert.ok(catalog.json().fields.some((field: { key: string }) => field.key === 'schedule'));
  assert.equal(catalog.body.includes('diagnosticCode'), false);
  const selected = await app.inject({ method: 'POST', url: '/observe', payload: {
    feature: 'tide', query: { fields: ['enabled', 'agentId'], maxTextChars: 30 },
  } });
  assert.equal(selected.statusCode, 200);
  assert.equal(selected.json().items[0].agentId, 'agent-a');
  assert.equal(selected.json().items[0].enabled, false);
  assert.equal('phase' in selected.json().items[0], false);
  const tiny = await app.inject({ method: 'POST', url: '/observe', payload: {
    feature: 'tide', query: { maxTextChars: 1, maxTextLines: 1 },
  } });
  assert.equal(tiny.statusCode, 200);
  assert.equal(tiny.json().completeness, 'partial');
  assert.equal(tiny.json().contentTruncated, true);
  assert.ok(tiny.json().nextCursor);
});

test('中心快照一次返回开放能力与所有功能区的真实摘要', async (t) => {
  const app = await setup(t);
  const response = await app.inject({ method: 'POST', url: '/snapshot', payload: {
    query: { view: 'summary', limit: 2, maxTextChars: 500, maxTextLines: 10 },
  } });
  assert.equal(response.statusCode, 200);
  const snapshot = response.json();
  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(snapshot.features.map((feature: { id: string }) => feature.id), [
    'monsoon', 'convection', 'cyclone', 'tradewind', 'tide',
  ]);
  const tide = snapshot.features.find((feature: { id: string }) => feature.id === 'tide');
  assert.equal(tide.title, '潮汐');
  assert.ok(tide.methods.some((method: { id: string }) => method.id === 'runTask'));
  assert.equal(tide.observation.feature, 'tide');
  assert.equal(tide.observation.items.length, 2);
  for (const feature of snapshot.features) {
    assert.equal(feature.observationFailure, undefined, `${feature.id} 事实出口不可读`);
    assert.equal(feature.observation?.feature, feature.id);
    const records = await app.inject({ method: 'POST', url: '/records/find',
      payload: { feature: feature.id, limit: 1 } });
    assert.equal(records.statusCode, 200, `${feature.id} 记录索引不可读`);
    assert.equal(records.json().feature, feature.id);
  }
  assert.equal(JSON.stringify(snapshot).includes('private prompt'), false);
});

test('HTTP 可按完整句柄读取单一运行事实供前端精确消费', async (t) => {
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const module = createTradewindModule({
    source: { snapshots: async () => [{
      operationId: 'wf-1', runId: 'exec-1', title: '发布', status: 'waiting',
      waitingReason: '等待人类关口',
    }] }, commands: {} as never,
  });
  await app.register(collaborationRoutes, { router: new CollaborationRouter([module]) });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/operation', payload: {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1',
  } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1',
    title: '发布', status: 'waiting', waitingReason: '等待人类关口',
  });
});

test('HTTP 可无轮询等待运行变化并返回同一探针事实', async t => {
  let status: 'running' | 'completed' = 'running';
  let notify = () => undefined;
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const module = createTradewindModule({
    source: {
      snapshots: async () => [{
        operationId: 'wf-1', runId: 'exec-1', title: '发布', status,
      }],
      subscribe: (_identity, listener) => {
        notify = listener;
        return () => undefined;
      },
    },
    commands: {} as never,
  });
  await app.register(collaborationRoutes, { router: new CollaborationRouter([module]) });
  t.after(() => app.close());
  const response = app.inject({ method: 'POST', url: '/operation/wait', payload: {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1', timeoutMs: 1_000,
  } });
  await new Promise(resolve => setImmediate(resolve));
  status = 'completed';
  notify();
  assert.deepEqual((await response).json(), {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1',
    title: '发布', status: 'completed', timedOut: false,
  });
});

test('collaboration HTTP rejects caller-controlled identity and unknown methods', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-collaboration-auth-'));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  const tide = createTideFeature({ dataDir });
  await app.register(collaborationRoutes, {
    router: createCollaborationRuntime({
      monsoonModule: createMonsoonFeature({ dataDir }).module, tideModule: tide.module,
      tradewindModule: createTradewindFeature({ dataDir }).module,
      convectionModule: createConvectionFeature({ dataDir }).module,
      cycloneModule: createCycloneFeature({ dataDir }).module,
    }),
  });
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const spoofed = await app.inject({
    method: 'POST', url: '/invoke',
    payload: {
      feature: 'tide', method: 'listTasks', input: {},
      actor: { type: 'agent', id: 'forged', actingAs: 'human' },
    },
  });
  assert.equal(spoofed.statusCode, 400);
  assert.equal(spoofed.json().errorCode, 'COLLABORATION_CALL_INVALID');

  const unknown = await app.inject({
    method: 'POST', url: '/invoke',
    payload: { feature: 'tide', method: 'missing', input: {} },
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().errorCode, 'FEATURE_METHOD_UNAVAILABLE');

  const spoofedObservation = await app.inject({
    method: 'POST', url: '/observe',
    payload: { feature: 'tide', query: {}, actor: { id: 'forged' } },
  });
  assert.equal(spoofedObservation.statusCode, 400);
  assert.equal(spoofedObservation.json().errorCode, 'COLLABORATION_OBSERVATION_INVALID');
});

function task(id: string, name: string, enabled: boolean) {
  return {
    id, name, schedule: 'every 5m', prompt: `${name} private prompt`, agentId: 'agent-a',
    repeatCount: -1, pushMode: 'accumulate' as const, windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled,
    createdAt: `2026-09-29T00:00:0${id.endsWith('b') ? 2 : 1}.000Z`,
  };
}

async function writeTasks(dataDir: string, tasks: unknown[]): Promise<void> {
  const file = tideTasksFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(tasks), 'utf8');
}
