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

test('信风控制与运行事实只保留中心入口', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tradewind-control-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir); app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const router = new CollaborationRouter([createTradewindFeature({ dataDir }).module]);
  const calls: Array<{ method: string; input: unknown }> = [];
  router.invoke = async call => {
    calls.push({ method: call.method, input: call.input });
    return { ok: true };
  };
  await app.register(collaborationRoutes, { prefix: '/api/collaboration', router });
  await app.register(tradewindRoutes, { prefix: '/api/tradewind', router });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  await invoke(app, 'startWorkflow', { workflowId: 'wf-1' });
  await invoke(app, 'stopWorkflow', { executionId: 'exec-1' });
  await invoke(app, 'submitHumanGate', {
    executionId: 'exec-1', nodeId: 'gate-1', content: '通过',
  });
  await invoke(app, 'abortNodeRound', { nodeId: 'writer', runId: 'node-round-1' });
  await invoke(app, 'pauseNodeRound', { nodeId: 'writer', runId: 'node-round-2' });
  await invoke(app, 'resumeNodeRound', { executionId: 'exec-1', nodeId: 'writer' });
  await invoke(app, 'abortMeetingRound', { nodeId: 'review', runId: 'meeting-round-1' });
  await invoke(app, 'endMeeting', { executionId: 'exec-1', nodeId: 'review' });
  await invoke(app, 'joinMeeting', {
    executionId: 'exec-1', nodeId: 'review', participantNodeId: 'writer',
  });
  await invoke(app, 'leaveMeeting', {
    executionId: 'exec-1', nodeId: 'review', participantNodeId: 'writer',
  });
  await invoke(app, 'reorderMeeting', {
    executionId: 'exec-1', nodeId: 'review', order: ['writer'],
  });
  await invoke(app, 'sendNodeMessage', {
    executionId: 'exec-1', nodeId: 'writer', message: '继续',
  });
  await invoke(app, 'speakMeeting', {
    executionId: 'exec-1', nodeId: 'review', message: '开始评审',
  });
  await invoke(app, 'messageMeetingChair', {
    executionId: 'exec-1', nodeId: 'review', message: '分析风险',
  });

  const oldRoutes = [
    ['GET', '/api/tradewind/status'],
    ['POST', '/api/tradewind/run'], ['POST', '/api/tradewind/stop'],
    ['POST', '/api/tradewind/human-gate/gate-1/submit'],
    ['POST', '/api/tradewind/chat/writer/abort'], ['POST', '/api/tradewind/chat/writer/pause'],
    ['POST', '/api/tradewind/chat/writer/resume'],
    ['POST', '/api/tradewind/meeting/review/abort-round'],
    ['POST', '/api/tradewind/meeting/review/end'],
    ['POST', '/api/tradewind/meeting/review/join'],
    ['POST', '/api/tradewind/meeting/review/leave'],
    ['POST', '/api/tradewind/meeting/review/reorder'],
    ['POST', '/api/tradewind/chat/writer'],
    ['POST', '/api/tradewind/meeting/review/speak'],
    ['POST', '/api/tradewind/meeting/review/chair'],
  ];
  for (const [method, url] of oldRoutes) {
    assert.equal((await app.inject({ method, url })).statusCode, 404, `${method} ${url}`);
  }
  assert.deepEqual(calls.map(call => call.method), [
    'startWorkflow', 'stopWorkflow', 'submitHumanGate', 'abortNodeRound',
    'pauseNodeRound', 'resumeNodeRound', 'abortMeetingRound', 'endMeeting',
    'joinMeeting', 'leaveMeeting', 'reorderMeeting',
    'sendNodeMessage', 'speakMeeting', 'messageMeetingChair',
  ]);
  assert.deepEqual(calls[1]?.input, { executionId: 'exec-1' });
});

function invoke(app: ReturnType<typeof Fastify>, method: string, input: unknown) {
  return app.inject({ method: 'POST', url: '/api/collaboration/invoke', payload: {
    feature: 'tradewind', method, input,
  } });
}
