import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { createTradewindRuntimeSource } from './execution-adapter.js';
import { createTradewindWorkflowStore } from './workflow-store.js';
import { getActiveTradewindOrchestrator, startTradewindExecution,
  stopActiveTradewindExecution } from '../../../services/tradewind-execution.js';
import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/index.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { createTradewindRecordPort } from './record-adapter.js';

test('信风精确查询从归档恢复已切换离场的运行终态', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-inspect-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workflowId = 'workflow-a';
  const runId = 'execution-a';
  const store = createTradewindWorkflowStore(dataDir);
  await store.save({ workflowId, name: '发布流程', graph: { nodes: [], edges: [] }, expectedRevision: null });
  const runDir = tradewindRunDir(dataDir, workflowId, runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify({
    workflowId, executionId: runId, status: 'done',
    startTime: '2026-09-30T00:00:00.000Z', endTime: '2026-09-30T00:01:00.000Z',
  }));
  await fs.writeFile(path.join(runDir, 'output.json'), JSON.stringify([
    { source: 'reviewer', content: '发布检查通过', timestamp: '2026-09-30T00:01:00.000Z' },
  ]));

  assert.deepEqual(await createTradewindRuntimeSource(dataDir, store).inspect?.({
    operationId: workflowId, runId,
  }), {
    operationId: workflowId, runId, title: '发布流程', status: 'completed',
    updatedAt: '2026-09-30T00:01:00.000Z',
    resultSummary: 'reviewer: 发布检查通过',
  });
});

test('historical handoff failures retain the committed error identity after leaving memory', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-failure-identity-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workflowId = 'wf-failure'; const runId = 'exec-failure';
  const directory = tradewindRunDir(dataDir, workflowId, runId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({ workflowId, executionId: runId,
    status: 'error', errorCode: 'TRADEWIND_HANDOFF_NOT_SEALED', errorMessage: '节点没有完成有效的单目标封口' }));
  const snapshot = await createTradewindRuntimeSource(dataDir).inspect?.({ operationId: workflowId, runId });
  assert.equal(snapshot?.status, 'failed');
  assert.equal(snapshot?.errorCode, 'TRADEWIND_HANDOFF_NOT_SEALED');
  assert.equal(snapshot?.errorMessage, '节点没有完成有效的单目标封口');
});

function waitingGraph(): WorkflowGraph {
  const nodes = ['entry', 'human-gate', 'output'].map((type, index) => ({
    id: type, type, label: type, position: { x: index * 100, y: 0 }, config: {},
  }));
  return { nodes, edges: [
    { id: 'first', source: 'entry', sourcePort: 0, target: 'human-gate', targetPort: 0, kind: 'handoff' },
    { id: 'second', source: 'human-gate', sourcePort: 0, target: 'output', targetPort: 0, kind: 'handoff' },
  ] };
}

test('真实执行终态 IO 失败经探针反馈同一错误身份而非成功或 running', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-inspect-io-'));
  t.after(async () => { await stopActiveTradewindExecution();
    await fs.rm(dataDir, { recursive: true, force: true }); });
  const workflowId = 'workflow-io';
  const graph = waitingGraph();
  const store = createTradewindWorkflowStore(dataDir);
  await store.save({ workflowId, name: '归档验收', graph, expectedRevision: null });
  const started = await startTradewindExecution({ dataDir, workflowId, graph,
    initialInput: '等待确认', mode: 'manual', trigger: { source: 'user' } });
  const orchestrator = getActiveTradewindOrchestrator();
  assert.ok(orchestrator);
  const meta = path.join(started.runDir, 'meta.json');
  await fs.rename(meta, path.join(started.runDir, 'saved-running.json'));
  await fs.mkdir(meta);
  await assert.rejects(stopActiveTradewindExecution(), error =>
    error instanceof FrameworkError && error.data.code === 'TRADEWIND_ARCHIVE_WRITE_FAILED');
  assert.equal(await orchestrator.whenSettled(), 'error');
  const source = createTradewindRuntimeSource(dataDir, store);
  const snapshot = await source.inspect?.({ operationId: workflowId, runId: started.executionId });
  assert.equal(snapshot?.status, 'failed');
  assert.equal(snapshot?.errorCode, 'TRADEWIND_ARCHIVE_WRITE_FAILED');
  assert.match(snapshot?.errorMessage ?? '', /终态记录未能保存/);
  assert.equal((await source.snapshots())[0]?.status, 'failed');
  await fs.rmdir(meta);
  await fs.rename(path.join(started.runDir, 'saved-running.json'), meta);
  await startTradewindExecution({ dataDir, workflowId, graph: waitingGraph(),
    initialInput: '第二个任务等待确认', mode: 'manual', trigger: { source: 'user' } });
  const departed = await source.inspect?.({ operationId: workflowId, runId: started.executionId });
  assert.equal(departed?.status, 'failed');
  assert.equal(departed?.errorCode, 'TRADEWIND_ARCHIVE_WRITE_FAILED');
  const records = createTradewindRecordPort(dataDir);
  const context = { actor: { type: 'human' as const, id: 'local' }, audience: 'human' as const,
    enabledFeatures: new Set(['tradewind' as const]), permissions: new Set(['observe' as const]),
    requestId: 'archive-io-check' };
  assert.equal((await records.list(context)).find(item => item.runId === started.executionId)?.status, 'failed');
  const detail = (await records.read(context, { operationId: workflowId, runId: started.executionId })) as {
    fact: { status: string; errorCode?: string } };
  assert.equal(detail.fact.status, 'failed');
  assert.equal(detail.fact.errorCode, 'TRADEWIND_ARCHIVE_WRITE_FAILED');
});
