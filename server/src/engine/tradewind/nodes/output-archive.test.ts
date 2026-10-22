import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../shared/framework-error.js';
import type { ExecutionContext, NodeExecutor, WorkflowGraph } from '../foundation/types/index.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { EntryExecutor } from './entry.js';
import { OutputExecutor } from './output.js';

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-output-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const runDir = path.join(dataDir, 'tradewind', 'runs', 'wf', 'run');
  const meetings = path.join(runDir, 'meetings');
  const transcripts = path.join(dataDir, 'tradewind', 'workflows', 'wf', 'workspace', 'transcripts');
  await fs.mkdir(meetings, { recursive: true });
  const events: string[] = [];
  const context = { dataDir, runDir, workflowId: 'wf', executionId: 'run', nodeId: 'output',
    nodeConfig: { archiveName: 'delivery' }, nodeLabelMap: {}, setState: () => {},
    waitForInputs: async () => [{ source: 'entry', content: '正式交付', timestamp: Date.now() }],
    emit: async (event: string) => { events.push(event); },
  } as unknown as ExecutionContext;
  return { dataDir, runDir, meetings, transcripts, events, context };
}

function archiveFailed(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TRADEWIND_OUTPUT_ARCHIVE_FAILED';
}

test('出口归档读取真实会议数组并排除同目录用量侧文件', async t => {
  const item = await fixture(t);
  await fs.writeFile(path.join(item.meetings, 'meeting-1.json'),
    JSON.stringify([{ speaker: '核验员', content: '核验一致' }]));
  await fs.writeFile(path.join(item.meetings, 'meeting-usage.json'), '{"totalTokens":123}');
  await fs.writeFile(path.join(item.meetings, 'meeting-1-usage.json'), '{"totalTokens":456}');
  await new OutputExecutor().execute(item.context);
  const md = await fs.readFile(path.join(item.transcripts, 'delivery.md'), 'utf8');
  assert.match(md, /核验员/);
  assert.match(md, /核验一致/);
  assert.match(md, /正式交付/);
  assert.ok(!md.includes('totalTokens'));
  assert.equal(item.events.length, 1);
});

test('出口兼容对象形态会议快照，公开与会长记录分别保留', async t => {
  const item = await fixture(t);
  await fs.writeFile(path.join(item.meetings, 'meeting-1.json'), JSON.stringify({
    publicMessages: [{ speaker: '核验员', content: '公开结论' }],
    chairMessages: [{ role: 'assistant', content: '会长私聊' }],
  }));
  await new OutputExecutor().execute(item.context);
  const md = await fs.readFile(path.join(item.transcripts, 'delivery.md'), 'utf8');
  assert.match(md, /公开结论/);
  assert.match(md, /会长私聊/);
});

test('损坏的会议记录保留原文件并阻止出口冒充成功', async t => {
  const item = await fixture(t);
  const file = path.join(item.meetings, 'meeting-1.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(new OutputExecutor().execute(item.context), archiveFailed);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  assert.deepEqual(item.events, []);
});

test('输出文件提交失败不发布完成，也不自动重新执行', async t => {
  const item = await fixture(t);
  await fs.mkdir(path.join(item.runDir, 'output.json'));
  await assert.rejects(new OutputExecutor().execute(item.context), archiveFailed);
  assert.deepEqual(item.events, []);
});

test('真实编排器将出口归档 IO 失败保存为 error 而非 done', async t => {
  const item = await fixture(t);
  const graph: WorkflowGraph = { nodes: ['entry', 'output'].map(type => ({
    id: type, type, label: type, position: { x: 0, y: 0 }, config: {},
  })), edges: [{ id: 'edge', source: 'entry', sourcePort: 0,
    target: 'output', targetPort: 0, kind: 'handoff' }] };
  const orchestrator = new Orchestrator({ dataDir: item.dataDir, workflowId: 'wf', graph,
    executors: new Map<string, NodeExecutor>([['entry', new EntryExecutor()], ['output', new OutputExecutor()]]),
  });
  await fs.mkdir(path.join(orchestrator.getRunDir(), 'output.json'), { recursive: true });
  await orchestrator.start();
  assert.equal(await orchestrator.whenSettled(), 'error');
  assert.equal(orchestrator.getFailure()?.data.code, 'TRADEWIND_OUTPUT_ARCHIVE_FAILED');
  const meta = JSON.parse(await fs.readFile(path.join(orchestrator.getRunDir(), 'meta.json'), 'utf8'));
  assert.equal(meta.status, 'error');
});
