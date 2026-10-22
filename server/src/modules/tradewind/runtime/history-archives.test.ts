import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getMeetingFileName } from '../../../engine/tradewind/foundation/archive-paths.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { createTradewindFeature } from '../api/factory.js';
import { createTradewindHistoryPort } from './history-adapter.js';

const identity = { workflowId: 'workflow-a', executionId: 'run-a' };
const at = '2026-10-20T01:00:00.000Z';
const node = (id: string, type = 'agent') => ({ id, type, label: id, position: { x: 0, y: 0 }, config: {} });
async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-run-archives-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'tradewind', 'runs', identity.workflowId, identity.executionId);
  await fs.mkdir(path.join(directory, 'nodes', 'worker'), { recursive: true });
  await fs.mkdir(path.join(directory, 'meetings'), { recursive: true });
  await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({ ...identity, status: 'done', startTime: at }));
  const graph = { nodes: [node('worker'), node('legacy:review', 'meeting'), node('output', 'output')], edges: [] };
  await fs.writeFile(path.join(directory, 'graph-snapshot.json'), JSON.stringify(graph));
  return { root, directory, graph, port: createTradewindHistoryPort(root) };
}

test('归档清单仅提供轻量事实，交付/节点上下文/合法冒号会议正文按需分段读取', async t => {
  const { directory, port } = await fixture(t);
  const output = [{ source: 'worker', content: '交付'.repeat(10_000), timestamp: at }];
  await fs.writeFile(path.join(directory, 'output.json'), JSON.stringify(output));
  await fs.writeFile(path.join(directory, 'nodes', 'worker', 'messages.json'), JSON.stringify([
    { role: 'system', content: 'PRIVATE_SYSTEM'.repeat(2000) },
    { role: 'user', content: '[系统信息：工作流上游传来的工作指令]\nPRIVATE_ENV' },
    { role: 'user', content: '实际人类问题' },
    { role: 'assistant', content: '真实节点结果', reasoningContent: 'PRIVATE_REASONING', rawContent: 'PRIVATE_RAW',
      toolCalls: [{ id: 'call-a', name: 'read_file', arguments: '{"path":"actual.ts"}', reasoning: 'PRIVATE_TOOL_REASONING' }] },
    { role: 'tool', toolCallId: 'call-a', content: '实际工具结果', toolOk: true },
  ]));
  await fs.writeFile(path.join(directory, 'meetings', getMeetingFileName('legacy:review', 2)), JSON.stringify([
    { speaker: 'worker', content: '会议结果', timestamp: 1 },
  ]));
  const run = await port.read(identity);
  assert.equal(run.archives?.length, 3);
  assert.ok(run.archives?.every(item => item.state === 'available' && item.sizeBytes! > 0));
  assert.equal(JSON.stringify(run).includes('真实节点结果'), false);
  const input = { ...identity, kind: 'output' as const, offset: 0, maxChars: 7000 };
  let fragment = await port.archive(input), combined = fragment.text;
  assert.equal(fragment.nextOffset, 7000);
  while (fragment.nextOffset !== undefined) {
    fragment = await port.archive({ ...input, offset: fragment.nextOffset });
    combined += fragment.text;
  }
  assert.deepEqual(JSON.parse(combined), output);
  const nodeArchive = await port.archive({ ...input, kind: 'node-context', nodeId: 'worker' });
  assert.equal(nodeArchive.presentation, 'public-conversation');
  assert.match(nodeArchive.text, /真实节点结果/);
  assert.match(nodeArchive.text, /实际人类问题/);
  assert.match(nodeArchive.text, /read_file/);
  assert.match(nodeArchive.text, /实际工具结果/);
  assert.doesNotMatch(nodeArchive.text, /PRIVATE_|reasoning|rawContent|toolCallId/);
  assert.match((await port.archive({ ...input, kind: 'meeting', nodeId: 'legacy:review', round: 2 })).text, /会议结果/);
});

test('公开会话投影先于分片，长系统提示不会出现在首片或后续片，原档保留', async t => {
  const { directory, port } = await fixture(t);
  const messages = [
    { role: 'system', content: 'PRIVATE_PROMPT'.repeat(3000) },
    { role: 'user', content: '实际提问' },
    { role: 'assistant', content: '可见正文'.repeat(6000), reasoningEnvelope: { secret: 'PRIVATE_THINKING' } },
  ];
  const file = path.join(directory, 'nodes', 'worker', 'messages.json');
  const raw = JSON.stringify(messages); await fs.writeFile(file, raw);
  const input = { ...identity, kind: 'node-context' as const, nodeId: 'worker', offset: 0, maxChars: 16_384 };
  let fragment = await port.archive(input), text = fragment.text;
  assert.match(text, /实际提问/);
  assert.ok(fragment.nextOffset);
  while (fragment.nextOffset !== undefined) {
    fragment = await port.archive({ ...input, offset: fragment.nextOffset });
    assert.equal(fragment.presentation, 'public-conversation');
    text += fragment.text;
  }
  assert.doesNotMatch(text, /PRIVATE_|reasoningEnvelope/);
  assert.equal(JSON.parse(text).at(-1).content, messages[2].content);
  assert.equal(await fs.readFile(file, 'utf8'), raw);
});

test('缺失归档明确可见，人类与 Agent 的归档查询均拒绝越界', async t => {
  const { root, directory, port } = await fixture(t);
  assert.ok((await port.read(identity)).archives?.every(item => item.state === 'missing'));
  const input = { ...identity, kind: 'output' as const, offset: 0, maxChars: 100 };
  await assert.rejects(port.archive(input), /不存在|尚未生成/);
  await assert.rejects(port.archive({ ...input, offset: -1 }), /参数/);
  await assert.rejects(port.archive({ ...input, maxChars: 16_385 }), /参数/);
  const file = await fs.open(path.join(directory, 'output.json'), 'w');
  await file.truncate(32 * 1024 * 1024 + 1); await file.close();
  await assert.rejects(port.archive(input), /超过/);
  await fs.writeFile(path.join(directory, 'output.json'), JSON.stringify([{ content: '真实交付' }]));
  await assert.rejects(port.archive({ ...input, offset: 500 }), /偏移/);
  await assert.rejects(port.archive({ ...input, workflowId: 'workflow-b' }), /不存在/);
  const router = new CollaborationRouter([createTradewindFeature({ dataDir: root }).module]);
  const context = { actor: { type: 'human' as const, id: 'local' }, audience: 'human' as const,
    enabledFeatures: new Set(['tradewind' as const]), permissions: new Set(['observe' as const]), requestId: 'archive-test' };
  const query = { feature: 'tradewind' as const, method: 'readWorkflowRunArchive', input };
  assert.match((await router.invoke(query, context) as { text: string }).text, /真实交付/);
  assert.match((await router.invoke(query, { ...context, actor: { type: 'agent', id: 'coordinator', actingAs: 'human' },
    audience: 'agent' }) as { text: string }).text, /真实交付/);
  await assert.rejects(router.invoke({ ...query, input: { ...input, nodeId: 'worker' } }, context), /参数/);
});

test('节点归档限定当前快照归属并拒绝目录穿越、junction与会议文件名映射歧义', async t => {
  const { root, directory, graph, port } = await fixture(t);
  const input = { ...identity, kind: 'node-context' as const, nodeId: 'other-worker', offset: 0, maxChars: 100 };
  await assert.rejects(port.archive(input), /不属于/);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'messages.json'), JSON.stringify([{ role: 'assistant', content: 'outside-secret' }]));
  await fs.rm(path.join(directory, 'nodes', 'worker'), { recursive: true });
  await fs.symlink(outside, path.join(directory, 'nodes', 'worker'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(port.archive({ ...input, nodeId: 'worker' }), /符号链接/);
  await fs.rm(path.join(directory, 'nodes', 'worker'));
  await fs.writeFile(path.join(directory, 'graph-snapshot.json'), JSON.stringify({ nodes: [node('../outside')], edges: [] }));
  await assert.rejects(port.archive({ ...input, nodeId: '../outside' }), /路径映射/);
  await fs.writeFile(path.join(directory, 'graph-snapshot.json'), JSON.stringify({ ...graph,
    nodes: [node('legacy:review', 'meeting'), node('legacy_review', 'meeting')] }));
  await assert.rejects(port.read(identity), /歧义/);
  await assert.rejects(port.archive({ ...input, kind: 'meeting', nodeId: 'legacy:review', round: 1 }), /歧义/);
});
