import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { createTradewindFeature } from '../api/factory.js';

test('信风旧归档按时间找到并分页读取事件与产出', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-records-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const dir = tradewindRunDir(dataDir, 'workflow-a', 'execution-a');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
    workflowId: 'workflow-a', executionId: 'execution-a', status: 'done',
    startTime: '2026-09-30T00:00:00.000Z', endTime: '2026-09-30T00:01:00.000Z',
  }));
  await fs.writeFile(path.join(dir, 'events.jsonl'), JSON.stringify({
    timestamp: '2026-09-30T00:00:10.000Z', nodeId: 'review', eventTypeId: 'work-done',
  }) + '\n');
  await fs.writeFile(path.join(dir, 'output.json'), JSON.stringify([
    { source: 'review', content: '检查完成' },
  ]));
  await fs.mkdir(path.join(dir, 'nodes', 'review'), { recursive: true });
  await fs.writeFile(path.join(dir, 'nodes', 'review', 'agent.json'),
    JSON.stringify({ agentId: 'agent-reviewer' }));
  const router = new CollaborationRouter([createTradewindFeature({ dataDir }).module]);
  const context = { actor: { type: 'agent' as const, id: 'main', actingAs: 'human' as const },
    audience: 'agent' as const, enabledFeatures: new Set(['tradewind' as const]),
    permissions: new Set(['observe' as const]), requestId: 'session-a' };
  const found = await router.listOperationRecords('tradewind', {}, context);
  assert.deepEqual(found.items.map(item => item.runId), ['execution-a']);
  assert.deepEqual(found.items[0]?.agentIds, ['agent-reviewer']);
  const attributed = await router.listOperationRecords('tradewind',
    { agentId: 'agent-reviewer' }, context);
  assert.equal(attributed.items.length, 1);
  const page = await router.readOperationRecord('tradewind', {
    operationId: 'workflow-a', runId: 'execution-a',
  }, { maxTextChars: 4_000 }, context);
  assert.match(page.text, /work-done/);
  assert.match(page.text, /检查完成/);
});
