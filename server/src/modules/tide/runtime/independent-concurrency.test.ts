import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { internalContext } from '../../../engine/collaboration/internal-context.js';
import { getAgentActivity, withAgentActivity } from '../../../engine/shared/agent-activity.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createTideFeature } from '../api/factory.js';
import type { TideRunRecord } from '../domain/run.js';
import { resolveTargetSessionId } from '../sessions/session-resolver.js';

test('同一池化 Agent 在季风忙碌时，两条独立每日潮汐任务仍同时开始并分别记录运行事实',
  { timeout: 10_000 }, async t => {
    const initial = new Date(2031, 0, 3, 7, 59, 59).getTime();
    t.mock.timers.enable({ apis: ['Date'], now: initial });
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-independent-'));
    const agentId = 'shared-pool-agent';
    const poolRelease = deferred();
    const tideRelease = deferred();
    const bothStarted = deferred();
    const started: Array<{ taskId: string; runId: string; sessionId: string }> = [];
    const registry = agentRegistryFile(dataDir);
    await fs.mkdir(path.dirname(registry), { recursive: true });
    await fs.writeFile(registry, JSON.stringify({ [agentId]: {
      id: agentId, name: '共享能力', model: 'test:model', config: { tools: [] },
    } }));

    // 季风已开始的独立会话只报告池中 Agent 忙碌，并不持有其他任务的执行锁。
    const existingConversation = withAgentActivity(agentId, 'conversation', () => poolRelease.promise);
    const feature = createTideFeature({ dataDir,
      execute: (dependencies, task, manual, runId) => withAgentActivity(agentId, 'tide', async () => {
        assert.equal(manual, false);
        assert.equal(task.agentId, agentId);
        const sessionId = resolveTargetSessionId(task);
        started.push({ taskId: task.id, runId, sessionId });
        if (started.length === 2) bothStarted.resolve();
        await tideRelease.promise;
        const record: TideRunRecord = { taskId: task.id, runId,
          timestamp: new Date().toISOString(), status: 'success', sessionId,
          pushMode: task.pushMode, answer: task.prompt, rawContent: task.prompt,
          toolCalls: [], turns: 1, durationMs: 1 };
        await dependencies.runs.save(record);
        return record;
      }),
    });
    t.after(async () => {
      tideRelease.resolve();
      poolRelease.resolve();
      await Promise.all([existingConversation, feature.scheduler.drain()]);
      await fs.rm(dataDir, { recursive: true, force: true });
    });
    const router = new CollaborationRouter([feature.module]);
    const context = internalContext('tide.scheduler', 'independent-daily-test', 'tide');
    feature.scheduler.bindScheduledTrigger(taskId => router.invoke({ feature: 'tide',
      method: 'triggerScheduledTask', input: { taskId } }, context));
    const first = await feature.tasks.create({ name: '晨间简报', schedule: 'daily 08:00',
      prompt: '整理晨间简报', agentId, pushMode: 'accumulate' });
    const second = await feature.tasks.create({ name: '资料检查', schedule: 'daily 08:00',
      prompt: '检查新资料', agentId, pushMode: 'accumulate' });
    assert.deepEqual(getAgentActivity(agentId), { busy: true, surfaces: ['conversation'] });
    assert.equal(first.nextRun, second.nextRun);

    t.mock.timers.setTime(initial + 1_000);
    await Promise.all([feature.scheduler.scanDue(), bothStarted.promise]);
    assert.equal(started.length, 2);
    assert.deepEqual(new Set(started.map(item => item.taskId)), new Set([first.id, second.id]));
    assert.equal(new Set(started.map(item => item.runId)).size, 2);
    assert.equal(new Set(started.map(item => item.sessionId)).size, 2);
    assert.deepEqual(new Set(getAgentActivity(agentId).surfaces), new Set(['conversation', 'tide']));
    for (const item of started) {
      assert.equal(feature.scheduler.isRunning(item.taskId), true);
      const fact = await feature.runStates.getRun(item.taskId, item.runId);
      assert.equal(fact?.status, 'running');
      assert.equal(fact?.trigger, 'schedule');
      assert.equal(fact?.agentId, agentId);
    }
    await feature.scheduler.scanDue();
    assert.equal(started.length, 2);

    tideRelease.resolve();
    await feature.scheduler.drain();
    for (const item of started) {
      assert.equal(feature.scheduler.isRunning(item.taskId), false);
      assert.equal((await feature.runStates.getRun(item.taskId, item.runId))?.status, 'completed');
      const records = await feature.tasks.listRuns(item.taskId, 10);
      assert.equal(records.length, 1);
      assert.equal(records[0]?.runId, item.runId);
      assert.equal(records[0]?.sessionId, item.sessionId);
    }
    assert.deepEqual(getAgentActivity(agentId), { busy: true, surfaces: ['conversation'] });
    poolRelease.resolve();
    await existingConversation;
    assert.deepEqual(getAgentActivity(agentId), { busy: false, surfaces: [] });
  });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
