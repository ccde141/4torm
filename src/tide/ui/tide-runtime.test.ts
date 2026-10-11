import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollaborationProbeItem } from '../../api/collaboration.js';
import { isOptimisticTideRun, reconcileSelectedTideTask, resolveTideRuntime, visibleTideNextRun, waitForTideRun } from './tide-runtime.js';

const task = { enabled: true, repeatCount: -1 };

test('手动运行收到 runId 后不再用本地排队态遮住终态探针', () => {
  const manualRuns = new Map<string, string | null>([['task-1', null]]);
  assert.equal(isOptimisticTideRun(manualRuns, 'task-1'), true);
  manualRuns.set('task-1', 'run-1');
  assert.equal(isOptimisticTideRun(manualRuns, 'task-1'), false);
});

test('已完成任务不展示旧的下次触发时间', () => {
  const nextRun = '2026-10-01T00:00:00.000Z';
  assert.equal(visibleTideNextRun({ enabled: true, repeatCount: 0, nextRun }), undefined);
  assert.equal(visibleTideNextRun({ enabled: true, repeatCount: 1, nextRun }), nextRun);
  assert.equal(visibleTideNextRun({ enabled: false, repeatCount: 1, nextRun }), undefined);
});

test('旧轮次已完成探针不能覆盖当前任务的暂停或再次计划状态', () => {
  const completed = { operationId: 'tide-a', title: '回归', status: 'completed', runId: 'run-1' };
  assert.deepEqual(resolveTideRuntime({ enabled: false, repeatCount: 1 }, completed, false), {
    kind: 'paused', active: false,
  });
  assert.deepEqual(resolveTideRuntime({ enabled: true, repeatCount: 1 }, completed, false), {
    kind: 'scheduled', active: false,
  });
});

test('任务列表刷新后详情跟随同一任务的新状态，实体删除后不保留旧详情', () => {
  const previous = { id: 'tide-a', enabled: true, repeatCount: 1 };
  const updated = { ...previous, enabled: false };
  assert.equal(reconcileSelectedTideTask(previous, [updated]), updated);
  assert.equal(reconcileSelectedTideTask(previous, []), null);
  assert.equal(reconcileSelectedTideTask(null, [updated]), null);
});

test('普通计划待命与带 runId 的排队执行具有不同语义', () => {
  assert.deepEqual(resolveTideRuntime(task, {
    operationId: 'task-1', title: 'daily', status: 'idle', enabled: true,
  }, false), { kind: 'scheduled', active: false });

  assert.deepEqual(resolveTideRuntime(task, {
    operationId: 'task-1', title: 'daily', status: 'queued',
  }, false), { kind: 'scheduled', active: false });

  assert.deepEqual(resolveTideRuntime(task, {
    operationId: 'task-1', title: 'daily', status: 'queued', runId: 'run-1',
  }, false), { kind: 'queued', active: true });
});

test('失败与崩溃事实不会被本地 enabled 状态遮住', () => {
  const failed: CollaborationProbeItem = {
    operationId: 'task-1', title: 'daily', status: 'failed', runId: 'run-1',
    errorMessage: '模型服务不可用',
  };
  assert.deepEqual(resolveTideRuntime(task, failed, false), {
    kind: 'failed', active: false, error: '模型服务不可用',
  });
});

test('等待只接受同一 runId 的终态，忽略旧轮次完成事实', async () => {
  const snapshots: CollaborationProbeItem[] = [
    { operationId: 'task-1', title: 'daily', status: 'running', runId: 'run-2' },
    { operationId: 'task-1', title: 'daily', status: 'completed', runId: 'run-2' },
  ];
  let reads = 0;
  const result = await waitForTideRun('task-1', 'run-2', async () => snapshots[reads++]!, {
    timeoutMs: 100,
  });
  assert.equal(reads, 2);
  assert.equal(result.status, 'completed');
});

test('等待同一 runId 的失败事实时真实抛错', async () => {
  await assert.rejects(() => waitForTideRun('task-1', 'run-3', async () => ({
    operationId: 'task-1', title: 'daily', status: 'crashed', runId: 'run-3',
    errorMessage: '服务重启导致执行中断',
  }), { timeoutMs: 100 }), /服务重启导致执行中断/);
});

test('精确等待拒绝被其他运行身份替代的结果', async () => {
  await assert.rejects(() => waitForTideRun('task-1', 'run-3', async () => ({
    operationId: 'task-1', title: 'daily', status: 'completed', runId: 'run-4',
  }), { timeoutMs: 100 }), /运行身份不匹配/);
});
