import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { createConvectionFeature } from './factory.js';

test('对流旧轮次可按句柄检索，记录不臆造未归档消息', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-record-port-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createConvectionFeature({ dataDir });
  await feature.runs.start({ sessionId: 'conv-a', runId: 'run-a', round: 'public',
    startedAt: '2026-09-30T00:00:00.000Z' });
  await feature.runs.finish('conv-a', 'run-a', 'completed', undefined, ['agent-a']);
  const router = new CollaborationRouter([feature.module]);
  const context = { actor: { type: 'agent' as const, id: 'main', actingAs: 'human' as const },
    audience: 'agent' as const, enabledFeatures: new Set(['convection' as const]),
    permissions: new Set(['observe' as const]), requestId: 'session-a' };
  const found = await router.listOperationRecords('convection', {}, context);
  assert.deepEqual(found.items.map(item => item.runId), ['run-a']);
  assert.deepEqual(found.items[0]?.agentIds, ['agent-a']);
  assert.equal(found.items[0]?.sessionId, 'conv-a');
  const attributed = await router.listOperationRecords('convection', { agentId: 'agent-a' }, context);
  assert.equal(attributed.items.length, 1);
  const page = await router.readOperationRecord('convection', {
    operationId: 'conv-a', runId: 'run-a',
  }, {}, context);
  assert.match(page.text, /"status": "completed"/);
  assert.match(page.text, /"detailAvailable": false/);
});

test('对流记录索引展示会话标题，卡片不暴露机器会话 ID', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-title-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createConvectionFeature({ dataDir });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'chair-a': { name: '会长' }, 'agent-a': { name: '成员' },
  }));
  const session = await feature.sessions.create({ title: '架构复核会议',
    chairAgentId: 'chair-a', participantAgentIds: ['agent-a'] });
  await feature.runs.start({ sessionId: session.id, runId: 'run-a', round: 'public',
    startedAt: '2026-09-30T00:00:00.000Z' });
  await feature.runs.finish(session.id, 'run-a', 'completed', undefined, ['agent-a']);
  const records = await feature.module.records!.list({} as never);
  assert.equal(records[0]?.title, '架构复核会议');
});
