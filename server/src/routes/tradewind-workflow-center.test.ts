import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { createTradewindFeature } from '../modules/tradewind/public.js';
import { collaborationRoutes } from './collaboration.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { tradewindRoutes } from './tradewind.js';

const graph = {
  nodes: [{ id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

test('信风工作流定义的读写只经过中心接口', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-center-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir); app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const router = new CollaborationRouter([createTradewindFeature({ dataDir }).module]);
  await app.register(collaborationRoutes, { prefix: '/api/collaboration', router });
  await app.register(tradewindRoutes, { prefix: '/api/tradewind', router });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const saved = await invoke(app, 'saveWorkflow', {
    workflowId: 'wf-1', name: '发布', graph, expectedRevision: null,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().saved, true);
  assert.equal(saved.json().workflowId, 'wf-1');
  assert.equal(saved.json().name, '发布');
  assert.match(saved.json().revision, /^[a-f0-9]{64}$/);
  const loaded = await invoke(app, 'loadWorkflow', { workflowId: 'wf-1' });
  assert.equal(loaded.statusCode, 200);
  assert.deepEqual(loaded.json().graph, graph);
  assert.deepEqual((await invoke(app, 'listWorkflowSummaries', {})).json().map(
    (item: { workflowId: string }) => item.workflowId,
  ), ['wf-1']);

  const profile = { id: 'p-1', name: '持续检查', cadence: { kind: 'relative', gapSec: 30 },
    overlap: 'skip', lapBound: null, carryOver: 'accumulate' };
  assert.equal((await invoke(app, 'saveWorkflowProfiles', {
    workflowId: 'wf-1', profiles: [profile],
  })).statusCode, 200);
  assert.deepEqual((await invoke(app, 'loadWorkflowProfiles', { workflowId: 'wf-1' })).json(), [profile]);
  assert.deepEqual((await invoke(app, 'deleteWorkflowProfile', {
    workflowId: 'wf-1', profileId: 'p-1',
  })).json(), { deleted: true, profileId: 'p-1' });

  assert.equal((await app.inject({ method: 'POST', url: '/api/tradewind/workflow/save',
    payload: { workflowId: 'wf-old', name: '旧入口', graph } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/tradewind/workflow/wf-1' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tradewind/workflow/wf-1/profiles',
    payload: { profiles: [profile] } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE',
    url: '/api/tradewind/workflow/wf-1/profiles/p-1' })).statusCode, 404);
  assert.equal((await app.inject('/api/tradewind/workflow/wf-1/profiles')).statusCode, 404);
  assert.equal((await app.inject('/api/tradewind/workflow/load/wf-1')).statusCode, 404);
  assert.equal((await app.inject('/api/tradewind/workflow/list')).statusCode, 404);

  const current = await invoke(app, 'loadWorkflow', { workflowId: 'wf-1' });
  const deleted = await invoke(app, 'deleteWorkflow', {
    workflowId: 'wf-1', expectedRevision: current.json().revision,
  });
  assert.deepEqual(deleted.json(), { deleted: true, workflowId: 'wf-1' });
  assert.equal((await invoke(app, 'loadWorkflow', { workflowId: 'wf-1' })).statusCode, 404);
});

function invoke(app: ReturnType<typeof Fastify>, method: string, input: unknown) {
  return app.inject({ method: 'POST', url: '/api/collaboration/invoke',
    payload: { feature: 'tradewind', method, input },
  });
}
