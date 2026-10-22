import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventBus } from '../foundation/event-bus.js';
import type { WorkflowGraph, NodeExecutor, ExecutionContext } from '../foundation/types/index.js';
import { HandoffRuntime } from './handoff-runtime.js';
import { Orchestrator } from './orchestrator.js';
import { EntryExecutor } from '../nodes/entry.js';
import { OutputExecutor } from '../nodes/output.js';
import { frameworkError } from '../../shared/framework-error.js';

function graph(): WorkflowGraph {
  return { orchestration: 'handoff', nodes: ['first', 'second', 'worker', 'reviewer', 'output'].map(id => ({
    id, type: id === 'first' || id === 'second' ? 'entry' : id === 'output' ? 'output' : 'agent',
    label: id, config: { initialEnvelope: id }, position: { x: 0, y: 0 },
  })), edges: [['first', 'worker'], ['second', 'worker'], ['worker', 'reviewer'], ['reviewer', 'worker'], ['reviewer', 'output']]
    .map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourcePort: 0, targetPort: 0, kind: 'handoff' })) };
}
async function temporary(action: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-handoff-'));
  try { await action(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('双入口 FIFO、返工保持 root、不分裂，全部逐封输出后才完成', async () => temporary(async root => {
  const abort = new AbortController();
  const events = new EventBus(path.join(root, 'events.jsonl'), true);
  const runtime = new HandoffRuntime({ graph: graph(), executionId: 'exec', runDir: root, eventBus: events, signal: abort.signal });
  for (const entry of ['first', 'second']) {
    await runtime.wait(entry);
    await runtime.send(entry, entry, 'handoff');
  }
  const [a] = await runtime.wait('worker');
  assert.equal(a.content, 'first');
  assert.equal(runtime.snapshot().nodes.find(node => node.nodeId === 'worker')!.queuedEnvelopeIds.length, 1);
  await assert.rejects(runtime.wait('worker'), /上一封/);
  await assert.rejects(runtime.send('worker', 'bad', 'handoff', undefined, { targetNodeId: 'output' }), /合法路线/);
  await runtime.send('worker', 'first-review', 'handoff', undefined, { targetNodeId: 'reviewer' });
  const [reviewA] = await runtime.wait('reviewer');
  await runtime.send('reviewer', 'first-rework', 'handoff', undefined, { edgeId: 'reviewer-worker' });
  const [b] = await runtime.wait('worker');
  assert.equal(b.content, 'second');
  assert.notEqual(a.envelopeId, b.envelopeId);
  await runtime.send('worker', 'second-done', 'handoff', undefined, { targetNodeId: 'reviewer' });
  const [reviewB] = await runtime.wait('reviewer');
  await runtime.send('reviewer', 'second-done', 'handoff', undefined, { targetNodeId: 'output' });
  const [outputB] = await runtime.wait('output');
  assert.equal(await runtime.finishOutput('output', outputB), false);
  const [reworkA] = await runtime.wait('worker');
  assert.equal(reworkA.envelopeId, a.envelopeId);
  assert.notEqual(reworkA.activationId, a.activationId);
  assert.equal(reviewA.envelopeId, reworkA.envelopeId);
  assert.equal(reviewB.envelopeId, b.envelopeId);
  await runtime.send('worker', 'first-fixed', 'handoff', undefined, { targetNodeId: 'reviewer' });
  await runtime.wait('reviewer');
  await runtime.send('reviewer', 'first-fixed', 'handoff', undefined, { targetNodeId: 'output' });
  const [outputA] = await runtime.wait('output');
  assert.equal(await runtime.finishOutput('output', outputA), true);
  const outputs = JSON.parse(await fs.readFile(path.join(root, 'output.json'), 'utf8'));
  assert.equal(new Set(outputs.map((item: { envelopeId: string }) => item.envelopeId)).size, 2);
  const facts = (await fs.readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(facts.every(item => item.payload.envelopeId && item.payload.activationId));
  assert.ok(facts.filter(item => item.eventTypeId === 'handoff-received').every(item =>
    item.payload.handoffId && item.payload.sentAt && item.payload.receivedAt && item.payload.source && item.payload.target));
  assert.equal(facts.filter(item => item.eventTypeId === 'envelope-completed').length, 2);
  abort.abort();
}));

test('事件提交失败不投递，停止拒绝等待且不创建完成事实', async () => temporary(async root => {
  const abort = new AbortController();
  const eventsFile = path.join(root, 'events.jsonl');
  const events = new EventBus(eventsFile, true);
  const runtime = new HandoffRuntime({ graph: graph(), executionId: 'exec', runDir: root, eventBus: events, signal: abort.signal });
  await runtime.wait('first');
  await fs.rm(eventsFile);
  await fs.mkdir(eventsFile);
  await assert.rejects(runtime.send('first', 'never-deliver', 'handoff'));
  assert.equal(runtime.snapshot().nodes.find(node => node.nodeId === 'worker')!.queuedEnvelopeIds.length, 0);
  const waiting = runtime.wait('reviewer');
  abort.abort();
  await assert.rejects(waiting, error => (error as Error).name === 'BufferAbortError');
  await assert.rejects(events.flush());
}));

function worker(execute: (context: ExecutionContext) => Promise<void>): NodeExecutor {
  return { type: 'agent', category: 'ai', label: 'worker', inputKinds: ['work'], outputKinds: ['handoff'],
    events: [], configSchema: () => ({}), validateConfig: () => true, execute };
}

test('真实 Orchestrator 条件交接可双入口走完，严格执行仍保留既有汇合语义', async () => temporary(async root => {
  const seen: string[] = [];
  const agent = worker(async context => {
    while (!context.signal.aborted) {
      const inputs = await context.waitForInputs();
      seen.push(`${context.nodeId}:${inputs.length}`);
      await context.sendHandoff(inputs.map(item => item.content).join('+'), 'handoff', undefined, undefined,
        { targetNodeId: context.nodeId === 'worker' ? 'reviewer' : 'output' });
    }
  });
  const executors = new Map<string, NodeExecutor>([['entry', new EntryExecutor()], ['output', new OutputExecutor()], ['agent', agent]]);
  const runtime = new Orchestrator({ graph: graph(), dataDir: root, workflowId: 'wf-handoff', executors });
  await runtime.start();
  assert.equal(await runtime.whenSettled(), 'done');
  assert.deepEqual(seen.filter(item => item.startsWith('worker')), ['worker:1', 'worker:1']);
  assert.equal(JSON.parse(await fs.readFile(path.join(runtime.getRunDir(), 'output.json'), 'utf8')).length, 2);
  const strict = graph(); strict.orchestration = 'strict';
  strict.edges = strict.edges.filter(edge => edge.id !== 'reviewer-worker');
  seen.length = 0;
  const old = new Orchestrator({ graph: strict, dataDir: root, workflowId: 'wf-strict', executors });
  await old.start(); assert.equal(await old.whenSettled(), 'done');
  assert.ok(seen.includes('worker:2'));
}));

test('非法交接真实失败，人工停止不伪造出口', async () => temporary(async root => {
  const executors = new Map<string, NodeExecutor>([['entry', new EntryExecutor()], ['output', new OutputExecutor()],
    ['agent', worker(async context => { await context.waitForInputs(); await context.sendHandoff('bad', 'handoff', undefined, undefined, { targetNodeId: 'missing' }); })]]);
  const failed = new Orchestrator({ graph: graph(), dataDir: root, workflowId: 'wf-fail', executors });
  await failed.start(); assert.equal(await failed.whenSettled(), 'error');
  assert.equal(JSON.parse(await fs.readFile(path.join(failed.getRunDir(), 'meta.json'), 'utf8')).status, 'error');
  executors.set('agent', worker(async context => {
    await context.waitForInputs();
    await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }));
  }));
  const stopped = new Orchestrator({ graph: graph(), dataDir: root, workflowId: 'wf-stop', executors });
  await stopped.start(); await stopped.stop(); assert.equal(await stopped.whenSettled(), 'stopped');
  await assert.rejects(fs.access(path.join(stopped.getRunDir(), 'output.json')));
}));

test('全部结果已交付但最终事实写入失败时，内存与 meta 均不能伪装成功', async () => temporary(async root => {
  const definition = graph();
  definition.nodes = definition.nodes.filter(node => node.type !== 'agent');
  definition.edges = definition.edges.filter(edge => edge.source === 'first' || edge.source === 'second')
    .map(edge => ({ ...edge, target: 'output' }));
  const executors = new Map<string, NodeExecutor>([['entry', new EntryExecutor()], ['output', new OutputExecutor()]]);
  const execution = new Orchestrator({ graph: definition, dataDir: root, workflowId: 'wf-fact-failure', executors });
  const bus = execution.getEventBus();
  const emit = bus.emit.bind(bus);
  bus.emit = event => event.eventTypeId === 'workflow-end' ? Promise.reject(frameworkError({
    code: 'TRADEWIND_EVENT_WRITE_FAILED', kind: 'io', message: '注入最终事实提交失败',
    source: 'test', retryable: false,
  })) : emit(event);
  await execution.start();
  assert.equal(await execution.whenSettled(), 'error');
  assert.equal(execution.getFailure()?.data.code, 'TRADEWIND_EVENT_WRITE_FAILED');
  const meta = JSON.parse(await fs.readFile(path.join(execution.getRunDir(), 'meta.json'), 'utf8'));
  assert.equal(meta.status, 'error');
  assert.equal(meta.errorCode, 'TRADEWIND_EVENT_WRITE_FAILED');
  assert.equal(JSON.parse(await fs.readFile(path.join(execution.getRunDir(), 'output.json'), 'utf8')).length, 2);
}));
