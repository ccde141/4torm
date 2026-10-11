import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { FileMonsoonRunRepository } from '../infrastructure/run-repository.js';
import { createMonsoonModule } from './module.js';

function context(agentId: string): CollaborationContext {
  return { actor: { type: 'agent', id: agentId, actingAs: 'human' },
    audience: 'agent', enabledFeatures: new Set(['monsoon']),
    permissions: new Set(['observe']), requestId: 'request-a' };
}

test('季风旧运行可按句柄查询，记录索引与现有精确查询权限一致', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'monsoon-record-port-'));
  try {
    const runs = new FileMonsoonRunRepository(dir);
    const record = (runId: string, agentId: string, updatedAt: string) => ({
      schemaVersion: 1 as const, sessionId: `session-${agentId}`,
      runId, agentId, status: 'completed' as const, phase: 'completed', updatedAt,
    });
    await runs.save(record('run-old', 'agent-a', '2026-09-30T00:00:00.000Z'));
    await runs.save(record('run-new', 'agent-a', '2026-10-01T00:00:00.000Z'));
    await runs.save(record('run-private', 'agent-b', '2026-10-01T01:00:00.000Z'));
    const router = new CollaborationRouter([createMonsoonModule({
      snapshot: () => ({ revision: 'latest', items: [] }),
      findRun: () => undefined, subscribeRun: () => () => undefined,
      abort: async () => false,
    }, { summary: async () => ({}) } as never, runs, {
      titles: async (agentId: string) => new Map([
        [`session-${agentId}`, `${agentId} 的真实会话标题`],
      ]),
    })]);
    const old = await router.inspectOperation('monsoon', {
      operationId: 'session-agent-a', runId: 'run-old',
    }, context('agent-a'));
    assert.deepEqual([old.runId, old.status], ['run-old', 'completed']);
    const list = await router.listOperationRecords('monsoon', {}, context('agent-a'));
    assert.deepEqual(list.items.map(item => item.runId), ['run-private', 'run-new', 'run-old']);
    const agentRuns = await router.listOperationRecords('monsoon',
      { agentId: 'agent-a' }, context('agent-a'));
    assert.deepEqual(agentRuns.items.map(item => item.runId), ['run-new', 'run-old']);
    assert.deepEqual(list.items.map(item => item.title), [
      'agent-b 的真实会话标题', 'agent-a 的真实会话标题', 'agent-a 的真实会话标题',
    ]);
    const page = await router.readOperationRecord('monsoon', {
      operationId: 'session-agent-a', runId: 'run-old',
    }, {}, context('agent-a'));
    assert.match(page.text, /"detailAvailable": false/);
    const other = await router.readOperationRecord('monsoon', {
      operationId: 'session-agent-b', runId: 'run-private',
    }, {}, context('agent-a'));
    assert.match(other.text, /run-private/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
