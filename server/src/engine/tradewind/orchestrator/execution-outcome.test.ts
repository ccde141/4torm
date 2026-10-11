import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
  const meta = JSON.parse(await fs.readFile(path.join(orchestrator.getRunDir(), 'meta.json'), 'utf8')) as { status: string };
  assert.equal(meta.status, 'done');
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
  assert.equal(await orchestrator.whenSettled(), 'stopped');
  const meta = JSON.parse(await fs.readFile(path.join(orchestrator.getRunDir(), 'meta.json'), 'utf8')) as { status: string };
  assert.equal(meta.status, 'stopped');
});

test('极速出口在 meta 与快照提交之后激活，仍通过编排器保存真实 done', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-instant-output-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const graph: WorkflowGraph = {
    nodes: ['entry', 'output'].map((type, x) => ({
      id: type, type, label: type, position: { x, y: 0 }, config: {},
    })),
    edges: [{ id: 'edge', source: 'entry', sourcePort: 0,
      target: 'output', targetPort: 0, kind: 'handoff' }],
  };
  let calls = 0;
  const instant = new OutputExecutor();
  instant.execute = async context => {
    calls++;
    const meta = JSON.parse(readFileSync(path.join(context.runDir, 'meta.json'), 'utf8'));
    const snapshot = JSON.parse(readFileSync(path.join(context.runDir, 'graph-snapshot.json'), 'utf8'));
    assert.equal(meta.status, 'running');
    assert.equal(snapshot.nodes.length, 2);
  };
  const map = executors();
  map.set('output', instant);
  const orchestrator = new Orchestrator({ graph, dataDir, workflowId: 'wf-instant', executors: map });
  await orchestrator.start();
  assert.equal(await orchestrator.whenSettled(), 'done');
  assert.equal(calls, 1);
  const meta = JSON.parse(await fs.readFile(path.join(orchestrator.getRunDir(), 'meta.json'), 'utf8'));
  assert.equal(meta.status, 'done');
});
