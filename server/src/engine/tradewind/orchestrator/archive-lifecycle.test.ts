import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../shared/framework-error.js';
import type { WorkflowGraph, NodeExecutor } from '../foundation/types/index.js';
import { Orchestrator } from './orchestrator.js';
import { EntryExecutor } from '../nodes/entry.js';
import { OutputExecutor } from '../nodes/output.js';
import { BUILTIN_EVENT_IDS } from '../foundation/types/index.js';

const graph: WorkflowGraph = {
  nodes: [{ id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
};

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-archive-life-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let executed = 0;
  const executor = new EntryExecutor();
  executor.execute = async () => { executed++; };
  const orchestrator = new Orchestrator({ graph: structuredClone(graph), dataDir, workflowId: 'wf',
    executors: new Map([['entry', executor]]) });
  return { dataDir, orchestrator, executed: () => executed };
}

function archiveError(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TRADEWIND_ARCHIVE_WRITE_FAILED';
}

function settledSoon(orchestrator: Orchestrator): Promise<string> {
  return Promise.race([orchestrator.whenSettled(),
    new Promise<string>(resolve => setTimeout(() => resolve('timed-out'), 150))]);
}

test('启动归档失败时不激活节点，也不遗留运行态或等待信号', async t => {
  const { orchestrator, executed } = await fixture(t);
  await fs.mkdir(path.join(orchestrator.getRunDir(), 'meta.json'), { recursive: true });
  await assert.rejects(orchestrator.start(), archiveError);
  assert.equal(orchestrator.isRunning(), false);
  assert.equal(orchestrator.getOutcome(), 'error');
  assert.equal(await settledSoon(orchestrator), 'error');
  assert.equal(executed(), 0);
});

test('停止归档失败仍释放执行资源并公布真实失败，不遗留 settled 等待', async t => {
  const { orchestrator, executed } = await fixture(t);
  await orchestrator.start();
  const meta = path.join(orchestrator.getRunDir(), 'meta.json');
  await fs.rename(meta, path.join(orchestrator.getRunDir(), 'saved-running.json'));
  await fs.mkdir(meta);
  const stopping = orchestrator.stop();
  assert.equal(orchestrator.isRunning(), true);
  assert.equal(orchestrator.getOutcome(), null);
  await assert.rejects(stopping, archiveError);
  assert.equal(orchestrator.isRunning(), false);
  assert.equal(orchestrator.getOutcome(), 'error');
  assert.equal(await settledSoon(orchestrator), 'error');
  assert.equal(executed(), 1);
  assert.equal(orchestrator.getFailure()?.data.code, 'TRADEWIND_ARCHIVE_WRITE_FAILED');
});

test('已生成输出的终态归档失败保留结果、反馈失败且不发送成功事件', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-archive-output-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let calls = 0;
  const output = new OutputExecutor();
  output.execute = async context => {
    calls++;
    const meta = path.join(context.runDir, 'meta.json');
    await fs.writeFile(path.join(context.runDir, 'output.json'), '"real-result"');
    await fs.rename(meta, path.join(context.runDir, 'saved-running.json'));
    await fs.mkdir(meta);
  };
  const outputGraph: WorkflowGraph = { nodes: [...structuredClone(graph.nodes), {
    id: 'output', type: 'output', label: '出口', position: { x: 200, y: 0 }, config: {} }],
    edges: [{ id: 'edge', source: 'entry', sourcePort: 0,
      target: 'output', targetPort: 0, kind: 'handoff' }] };
  const orchestrator = new Orchestrator({ graph: outputGraph, dataDir, workflowId: 'wf',
    executors: new Map<string, NodeExecutor>([['entry', new EntryExecutor()], ['output', output]]) });
  await orchestrator.start();
  assert.equal(await settledSoon(orchestrator), 'error');
  assert.equal(orchestrator.getOutcome(), 'error');
  assert.equal(orchestrator.getFailure()?.data.code, 'TRADEWIND_ARCHIVE_WRITE_FAILED');
  assert.equal(calls, 1);
  assert.equal(await fs.readFile(path.join(orchestrator.getRunDir(), 'output.json'), 'utf8'), '"real-result"');
  const events = await fs.readFile(path.join(orchestrator.getRunDir(), 'events.jsonl'), 'utf8');
  assert.match(events, /TRADEWIND_ARCHIVE_WRITE_FAILED/);
  assert.ok(!events.includes(BUILTIN_EVENT_IDS.WORKFLOW_END));
});
