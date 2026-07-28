import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EntryExecutor } from '../nodes/entry.js';
import { OutputExecutor } from '../nodes/output.js';
import type { NodeExecutor, WorkflowGraph } from '../foundation/types/index.js';
import { Orchestrator } from './orchestrator.js';

function executors(): Map<string, NodeExecutor> {
  return new Map([
    ['entry', new EntryExecutor()],
    ['output', new OutputExecutor()],
  ]);
}

test('编排器保留到达 output 的正常终态供状态接口读取', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-output-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const graph: WorkflowGraph = {
    nodes: [
      { id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} },
      { id: 'output', type: 'output', label: '出口', position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'edge', source: 'entry', sourcePort: 0, target: 'output', targetPort: 0, kind: 'handoff' },
    ],
  };
  const orchestrator = new Orchestrator({ graph, dataDir, workflowId: 'wf-output', executors: executors() });

  await orchestrator.start();
  assert.equal(await orchestrator.whenSettled(), 'done');
  assert.equal(orchestrator.getOutcome(), 'done');
});

test('未到达 output 的人工停止保留 stopped 终态', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-stopped-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const graph: WorkflowGraph = {
    nodes: [{ id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  };
  const orchestrator = new Orchestrator({ graph, dataDir, workflowId: 'wf-stopped', executors: executors() });

  await orchestrator.start();
  await orchestrator.stop();
  assert.equal(orchestrator.getOutcome(), 'stopped');
});
