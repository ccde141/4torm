import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { createTradewindFeature } from '../api/factory.js';
import { createTradewindHistoryPort } from './history-adapter.js';
import { startTradewindExecution, stopActiveTradewindExecution,
  getActiveTradewindOrchestrator } from '../../../services/tradewind-execution.js';
import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/index.js';

const at = '2026-10-15T01:00:00.000Z';
const context = { actor: { type: 'human' as const, id: 'local' }, audience: 'human' as const,
  enabledFeatures: new Set(['tradewind' as const]), permissions: new Set(['observe' as const]),
  requestId: 'record-test' };

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'tradewind/runs/workflow-a/run-a');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ workflowId: 'workflow-a',
    executionId: 'run-a', status: 'done', startTime: at, endTime: at }));
  await fs.writeFile(path.join(dir, 'graph-snapshot.json'), JSON.stringify({ nodes: [], edges: [] }));
  await fs.writeFile(path.join(dir, 'events.jsonl'), Array.from({ length: 5 }, (_, i) => JSON.stringify({
    timestamp: `2026-10-15T01:00:0${i}.000Z`, nodeId: 'writer',
    eventTypeId: i % 2 ? 'handoff' : 'work-done', payload: { text: `result-${i}` },
  })).join('\n') + '\n');
  return { root, dir, port: createTradewindHistoryPort(root) };
}

test('记录查询按真实身份与时间返回，事件过滤分页不重复，长正文按需读取', async t => {
  const { port } = await fixture(t);
  const first = await port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 1,
    eventType: 'handoff', since: at, until: '2026-10-15T01:00:04.000Z' });
  assert.equal(first.items[0]?.preview, '{"text":"result-1"}');
  assert.ok(first.nextCursor);
  const next = await port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 1,
    eventType: 'handoff', since: at, until: '2026-10-15T01:00:04.000Z', cursor: first.nextCursor });
  assert.equal(next.items[0]?.timestamp, '2026-10-15T01:00:03.000Z');
  assert.notEqual(first.items[0].eventOffset, next.items[0].eventOffset);
  const content = await port.event({ workflowId: 'workflow-a', executionId: 'run-a',
    eventOffset: first.items[0].eventOffset, offset: 0, maxChars: 8 });
  assert.equal(content.text, '{\n  "tex');
  assert.equal(content.nextOffset, 8);
  const run = await port.read({ workflowId: 'workflow-a', executionId: 'run-a' });
  assert.equal(run.startTime, at);
  assert.deepEqual(run.graph, { nodes: [], edges: [] });
  assert.equal((await port.list({ workflowId: 'workflow-a', limit: 2 })).items[0].status, 'completed');
});

test('跨工作流、损坏 meta/事件与伪造游标均真实报错', async t => {
  const { port, dir } = await fixture(t);
  await assert.rejects(port.read({ workflowId: 'workflow-b', executionId: 'run-a' }), /不存在/);
  await assert.rejects(port.events({ workflowId: 'workflow-a', executionId: 'run-a',
    limit: 2, cursor: 'garbage' }), /游标/);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ workflowId: 'workflow-b',
    executionId: 'run-a', status: 'done', startTime: at }));
  await assert.rejects(port.read({ workflowId: 'workflow-a', executionId: 'run-a' }), /身份/);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ workflowId: 'workflow-a',
    executionId: 'run-a', status: 'done', startTime: at }));
  await fs.writeFile(path.join(dir, 'events.jsonl'), '{broken}\n');
  await assert.rejects(port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 2 }), /事件/);
});

test('运行中不完整尾行保留待下次读取；终态不完整事件真实报错', async t => {
  const { port, dir } = await fixture(t);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ workflowId: 'workflow-a',
    executionId: 'run-a', status: 'running', startTime: at }));
  await fs.writeFile(path.join(dir, 'events.jsonl'), '{"timestamp":');
  assert.equal((await port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 2 })).items.length, 0);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ workflowId: 'workflow-a',
    executionId: 'run-a', status: 'done', startTime: at }));
  await assert.rejects(port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 2 }), /事件/);
});

test('运行查询同时服务人类与 Agent，原始事件详情仍保留人类边界', async t => {
  const { root } = await fixture(t);
  const router = new CollaborationRouter([createTradewindFeature({ dataDir: root }).module]);
  const result = await router.invoke({ feature: 'tradewind', method: 'listWorkflowRuns',
    input: { workflowId: 'workflow-a', limit: 2 } }, context);
  assert.equal((result as { items: unknown[] }).items.length, 1);
  const agent = { ...context, actor: { type: 'agent' as const, id: 'coordinator', actingAs: 'human' as const },
    audience: 'agent' as const };
  const runs = await router.invoke({ feature: 'tradewind', method: 'listWorkflowRuns',
    input: { workflowId: 'workflow-a' } }, agent);
  assert.equal((runs as { items: unknown[] }).items.length, 1);
  await assert.rejects(router.invoke({ feature: 'tradewind', method: 'readWorkflowRunEvent',
    input: { workflowId: 'workflow-a', executionId: 'run-a', eventOffset: 0 } }, agent), /受众|audience|调用|开放/);
});

test('初次 meta 尚未提交时记录精确报告准备中，损坏和后续丢失均不能被吞掉', { timeout: 5_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-history-start-'));
  const port = createTradewindHistoryPort(root);
  const workflowId = 'workflow-starting';
  let entered!: () => void; let release!: () => void;
  const blocked = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rename = fs.rename.bind(fs);
  let first = true;
  t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], target: Parameters<typeof fs.rename>[1]) => {
    if (first && String(target).includes(workflowId) && String(target).endsWith(`${path.sep}meta.json`)) {
      first = false; entered(); await gate;
    }
    return rename(source, target);
  });
  const graph: WorkflowGraph = { nodes: ['entry', 'human-gate', 'output'].map(type => ({
    id: type, type, label: type, config: {}, position: { x: 0, y: 0 },
  })), edges: ['entry', 'human-gate'].map((source, index) => ({
    id: `edge-${index}`, source, target: index === 0 ? 'human-gate' : 'output',
    sourcePort: 0, targetPort: 0, kind: 'handoff',
  })) };
  const starting = startTradewindExecution({ dataDir: root, workflowId, graph, trigger: { source: 'user' } });
  t.after(async () => {
    release(); await starting.catch(() => {});
    await stopActiveTradewindExecution({ workflowId, dataDir: root });
    await fs.rm(root, { recursive: true, force: true });
  });
  await blocked;
  const active = getActiveTradewindOrchestrator({ workflowId, dataDir: root });
  assert.ok(active?.isPreparing());
  const executionId = active.getExecutionId();
  const pending = await port.list({ workflowId, limit: 2 });
  assert.deepEqual(pending.items, []);
  assert.deepEqual(pending.preparingExecutionIds, [executionId]);
  const meta = path.join(active.getRunDir(), 'meta.json');
  await fs.writeFile(meta, '{broken}');
  await assert.rejects(port.list({ workflowId, limit: 2 }), /JSON/);
  await fs.rm(meta);
  const lstat = fs.lstat.bind(fs);
  let staleRead = true;
  t.mock.method(fs, 'lstat', async (file: Parameters<typeof fs.lstat>[0]) => {
    if (staleRead && String(file) === meta) {
      staleRead = false; release(); await starting;
      throw Object.assign(new Error('read raced initial commit'), { code: 'ENOENT' });
    }
    return lstat(file);
  });
  assert.equal((await port.list({ workflowId, limit: 2 })).items[0].status, 'running');
  assert.equal(active.isPreparing(), false);
  assert.equal((await port.list({ workflowId, limit: 2 })).items[0].status, 'running');
  await fs.rm(meta);
  await assert.rejects(port.list({ workflowId, limit: 2 }), /归档文件不存在/);
});

test('分页固定追加前的事件快照，游标不能换执行或筛选条件', async t => {
  const { root, port, dir } = await fixture(t);
  const first = await port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 2 });
  const extra = { timestamp: at, nodeId: 'writer', eventTypeId: 'later' };
  await fs.appendFile(path.join(dir, 'events.jsonl'), JSON.stringify(extra) + '\n');
  const rest = await port.events({ workflowId: 'workflow-a', executionId: 'run-a',
    limit: 100, cursor: first.nextCursor });
  assert.equal(rest.items.length, 3);
  assert.equal(rest.nextCursor, undefined);
  const refreshed = await port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 100 });
  assert.equal(refreshed.items.length, 6);
  await assert.rejects(port.events({ workflowId: 'workflow-a', executionId: 'run-a',
    limit: 100, cursor: first.nextCursor, eventType: 'handoff' }), /游标/);
  const other = path.join(root, 'tradewind/runs/workflow-a/run-b');
  await fs.cp(dir, other, { recursive: true });
  await fs.writeFile(path.join(other, 'meta.json'), JSON.stringify({ workflowId: 'workflow-a',
    executionId: 'run-b', status: 'done', startTime: at }));
  await assert.rejects(port.events({ workflowId: 'workflow-a', executionId: 'run-b',
    limit: 100, cursor: first.nextCursor }), /游标/);
  const runs = await port.list({ workflowId: 'workflow-a', limit: 1 });
  assert.equal(runs.items[0].executionId, 'run-b');
  assert.equal((await port.list({ workflowId: 'workflow-a', limit: 1,
    cursor: runs.nextCursor })).items[0].executionId, 'run-a');
});

test('缺失/损坏图快照不能替换成当前图，事件正文只分段返回', async t => {
  const { port, dir } = await fixture(t);
  await fs.rm(path.join(dir, 'graph-snapshot.json'));
  await assert.rejects(port.read({ workflowId: 'workflow-a', executionId: 'run-a' }), /不存在/);
  await fs.writeFile(path.join(dir, 'graph-snapshot.json'), '{broken');
  await assert.rejects(port.read({ workflowId: 'workflow-a', executionId: 'run-a' }), /JSON/);
  await fs.writeFile(path.join(dir, 'events.jsonl'), JSON.stringify({ timestamp: at,
    eventTypeId: 'handoff', nodeId: 'writer', payload: { text: '文'.repeat(100_000) } }) + '\n');
  const page = await port.events({ workflowId: 'workflow-a', executionId: 'run-a', limit: 1 });
  assert.equal(page.items[0].preview.length, 360);
  const first = await port.event({ workflowId: 'workflow-a', executionId: 'run-a',
    eventOffset: 0, offset: 0, maxChars: 16_384 });
  assert.equal(first.text.length, 16_384);
  assert.equal(first.nextOffset, 16_384);
  await assert.rejects(port.event({ workflowId: 'workflow-a', executionId: 'run-a',
    eventOffset: 5, offset: 0, maxChars: 100 }), /行边界/);
});

test('目录 junction 不能把其他工作流的运行引入当前工作流', async t => {
  const { root, port, dir } = await fixture(t);
  const linked = path.join(root, 'tradewind/runs/workflow-a/run-link');
  await fs.symlink(dir, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(port.read({ workflowId: 'workflow-a', executionId: 'run-link' }), /类型/);
  await assert.rejects(port.list({ workflowId: 'workflow-a', limit: 2 }), /符号链接/);
});

test('旧图节点 ID 不受磁盘路径标识约束，运行身份仍拒绝路径穿越', async t => {
  const { port, dir } = await fixture(t);
  const graph = { nodes: [{ id: 'legacy:reviewer', type: 'agent', label: '旧审核节点',
    config: {}, position: { x: 0, y: 0 } }], edges: [] };
  await fs.writeFile(path.join(dir, 'graph-snapshot.json'), JSON.stringify(graph));
  assert.deepEqual((await port.read({ workflowId: 'workflow-a', executionId: 'run-a' })).graph, graph);
  await assert.rejects(port.read({ workflowId: '../workflow-a', executionId: 'run-a' }), /身份/);
  await assert.rejects(port.read({ workflowId: 'workflow-a', executionId: '../run-a' }), /身份/);
});

test('运行中水位截断的尾片补齐并终态后，旧游标续读不误报损坏', async t => {
  const { port, dir } = await fixture(t);
  const identity = { workflowId: 'workflow-a', executionId: 'run-a' };
  const event = (nodeId: string) => JSON.stringify({ timestamp: at, nodeId, eventTypeId: 'work-done' });
  const last = event('last');
  const split = Math.floor(last.length / 2);
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ ...identity, status: 'running', startTime: at }));
  await fs.writeFile(path.join(dir, 'events.jsonl'), `${event('first')}\n${event('second')}\n${last.slice(0, split)}`);
  const first = await port.events({ ...identity, limit: 1 });
  assert.ok(first.nextCursor);
  await fs.appendFile(path.join(dir, 'events.jsonl'), last.slice(split) + '\n');
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ ...identity, status: 'done', startTime: at }));
  const rest = await port.events({ ...identity, limit: 100, cursor: first.nextCursor });
  assert.deepEqual(rest.items.map(item => item.nodeId), ['second']);
  assert.equal(rest.scannedToEnd, false);
  const refreshed = await port.events({ ...identity, limit: 100 });
  assert.deepEqual(refreshed.items.map(item => item.nodeId), ['first', 'second', 'last']);
  await fs.writeFile(path.join(dir, 'events.jsonl'), `${event('first')}\n${event('second')}\n{broken}\n`);
  await assert.rejects(port.events({ ...identity, limit: 100 }), /事件 JSON/);
});

test('长交接载荷提供独立有界来源与目标摘要，不复制正文或改变原始分段读取', async t => {
  const { port, dir } = await fixture(t);
  const identity = { workflowId: 'workflow-a', executionId: 'run-a' };
  const source = `page-writer-${'a'.repeat(120)}`;
  const target = `page-reviewer-${'b'.repeat(120)}`;
  const content = '真实交付正文'.repeat(1000);
  const payload = { envelopeId: `envelope-${'e'.repeat(140)}`, activationId: `activation-${'a'.repeat(140)}`,
    handoffId: `handoff-${'h'.repeat(140)}`, source, target, content };
  const logs = [payload, { source: 's'.repeat(161), target: {} }, { source: 123, target: '' }]
    .map(item => JSON.stringify({ timestamp: at, nodeId: source, eventTypeId: 'handoff-sent', payload: item }));
  await fs.writeFile(path.join(dir, 'events.jsonl'), logs.join('\n') + '\n');
  const page = await port.events({ ...identity, limit: 100 });
  const first = page.items[0];
  assert.equal(first.source, source);
  assert.equal(first.target, target);
  assert.equal(first.preview, JSON.stringify(payload).slice(0, 360));
  assert.throws(() => JSON.parse(first.preview));
  assert.equal('payload' in first, false);
  assert.equal(JSON.stringify(first).includes(content), false);
  assert.equal(page.items[1].source, undefined);
  assert.equal(page.items[1].target, undefined);
  assert.equal(page.items[2].source, undefined);
  assert.equal(page.items[2].target, undefined);
  const original = await port.event({ ...identity, eventOffset: first.eventOffset, offset: 0, maxChars: 16_384 });
  assert.deepEqual(JSON.parse(original.text), payload);
});
