import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { AgentToolOutput } from '../../../engine/collaboration/contracts.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { stopActiveTradewindExecution, isTradewindExecutionRunning } from '../../../services/tradewind-execution.js';
import { createTradewindWorkflowAdmin } from '../runtime/workflow-admin.js';
import { createTradewindFeature } from './factory.js';
import type { AutoProfile } from '../../../engine/tradewind/foundation/types/auto-profile.js';

const identity = { agentId: 'coordinator', sessionId: 'conversation-a' };
const profile: AutoProfile = { id: 'twice', name: '两圈验证', cadence: { kind: 'relative', gapSec: 0 },
  overlap: 'skip', lapBound: 2, carryOver: 'reset' };

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-agent-lifecycle-'));
  t.after(async () => {
    await stopActiveTradewindExecution();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'agents'), { recursive: true });
  await fs.writeFile(path.join(root, 'agents', 'registry.json'), '{}');
  const router = new CollaborationRouter([createTradewindFeature({ dataDir: root }).module]);
  const gateway = new AgentCollaborationGateway(router, async () => ({ toolMode: 'all', tools: [] }));
  const invoke = async (name: string, input: unknown) => {
    const result = await gateway.invokeTool(name, input, identity);
    return result instanceof AgentToolOutput ? result.value : result;
  };
  return { root, router, gateway, invoke };
}

async function create(invoke: (name: string, input: unknown) => Promise<unknown>, orchestration = 'strict') {
  const text = await invoke('create_workflow', { name: `核验-${orchestration}`, orchestration,
    nodes: [{ id: 'entry', type: 'entry', label: '输入', initialEnvelope: '发布清单' },
      { id: 'output', type: 'output', label: '交付' }], edges: [{ source: 'entry', target: 'output' }] });
  const workflowId = /wf-[a-z0-9-]+/.exec(String(text))?.[0];
  assert.ok(workflowId);
  return workflowId;
}

test('Agent 用真实工具完成双模式校验、配置循环、并行执行和归档核验，无模型开销', async t => {
  const { invoke } = await fixture(t);
  const workflows = await Promise.all(['strict', 'handoff'].map(async orchestration => {
    const workflowId = await create(invoke, orchestration);
    assert.equal((await invoke('validate_workflow', { workflowId, mode: 'auto' }) as { valid: boolean }).valid, true);
    const catalog = await invoke('list_workflow_profiles', { workflowId }) as { revision: string; text: string };
    assert.deepEqual(JSON.parse(catalog.text), []);
    const saved = await invoke('save_workflow_profile', { workflowId, profile,
      expectedRevision: catalog.revision }) as { saved: boolean };
    assert.equal(saved.saved, true);
    const started = await invoke('start_workflow', { workflowId, mode: 'auto', profileId: profile.id }) as {
      workflowId: string; executionId: string; loop: boolean;
    };
    assert.equal(started.workflowId, workflowId);
    assert.equal(started.loop, true);
    assert.ok(started.executionId);
    return { workflowId, orchestration };
  }));
  assert.notEqual(workflows[0].workflowId, workflows[1].workflowId);
  for (const { workflowId, orchestration } of workflows) {
    let runs: { items: { executionId: string; status: string }[] } = { items: [] };
    for (let attempt = 0; attempt < 100; attempt++) {
      runs = await invoke('list_workflow_runs', { workflowId }) as typeof runs;
      if (runs.items.length === 2 && runs.items.every(item => item.status === 'completed')) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(runs.items.length, 2);
    assert.ok(runs.items.every(item => item.status === 'completed'));
    const executionId = runs.items[0].executionId;
    const detail = await invoke('read_workflow_run', { workflowId, executionId }) as { text: string; status: string };
    assert.equal(detail.status, 'completed');
    const parsed = JSON.parse(detail.text);
    assert.equal(parsed.graph.orchestration, orchestration);
    assert.ok(parsed.archives.some((item: { kind: string; state: string }) => item.kind === 'output' && item.state === 'available'));
    const events = await invoke('read_workflow_run_events', { workflowId, executionId, limit: 1 }) as {
      items: unknown[]; nextCursor?: string;
    };
    assert.equal(events.items.length, 1);
    assert.ok(events.nextCursor);
    const output = await invoke('read_workflow_run_archive', { workflowId, executionId, kind: 'output' }) as { text: string };
    assert.ok(Array.isArray(JSON.parse(output.text)));
    await assert.rejects(invoke('read_workflow_run', { workflowId: 'other-workflow', executionId }), /不存在/);
  }
});

test('循环档案逐项保存保留其他配置，过期版本和损坏文件均不覆盖', async t => {
  const { root, invoke } = await fixture(t);
  const workflowId = await create(invoke);
  const original = await invoke('list_workflow_profiles', { workflowId }) as { revision: string };
  const first = await invoke('save_workflow_profile', { workflowId, profile, expectedRevision: original.revision }) as { revision: string };
  await assert.rejects(invoke('save_workflow_profile', { workflowId, profile: { ...profile, id: 'stale' },
    expectedRevision: original.revision }), /已变化/);
  const attempts = await Promise.allSettled(['one', 'two'].map(id => invoke('save_workflow_profile', {
    workflowId, profile: { ...profile, id }, expectedRevision: first.revision,
  })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  const catalog = await invoke('list_workflow_profiles', { workflowId }) as { revision: string; text: string };
  assert.equal(JSON.parse(catalog.text).length, 2);
  assert.ok(JSON.parse(catalog.text).some((item: { id: string }) => item.id === profile.id));
  await assert.rejects(invoke('save_workflow_profile', { workflowId,
    profile: { ...profile, cadence: { kind: 'absolute', by: 'tide' } }, expectedRevision: catalog.revision }), /参数无效/);
  const file = path.join(root, 'tradewind', 'workflows', workflowId, 'profiles.json');
  await fs.writeFile(file, JSON.stringify({ profiles: [{ ...profile, lapBound: -2 }] }));
  const damaged = await fs.readFile(file, 'utf8');
  await assert.rejects(invoke('save_workflow_profile', { workflowId, profile, expectedRevision: catalog.revision }), /读取循环档案失败/);
  assert.equal(await fs.readFile(file, 'utf8'), damaged);
});

test('Agent 运行记录与档案正文按偏移继续读取，归档会话不输出系统词或思考', async t => {
  const { root, invoke } = await fixture(t);
  const workflowId = await create(invoke);
  const admin = createTradewindWorkflowAdmin(root);
  await admin.saveProfiles(workflowId, [{ ...profile, loopNote: '持续工作'.repeat(600) }]);
  const first = await invoke('list_workflow_profiles', { workflowId, maxChars: 20 }) as { text: string; nextOffset: number; revision: string };
  assert.equal(first.text.length, 20);
  assert.equal(first.nextOffset, 20);
  const next = await invoke('list_workflow_profiles', { workflowId, offset: first.nextOffset,
    revision: first.revision, maxChars: 20 }) as { text: string };
  assert.notEqual(next.text, first.text);
  await assert.rejects(invoke('list_workflow_profiles', { workflowId, offset: first.nextOffset }), /分页参数/);
  await admin.saveProfiles(workflowId, [{ ...profile, name: '新运行目标' }]);
  await assert.rejects(invoke('list_workflow_profiles', { workflowId, offset: first.nextOffset,
    revision: first.revision }), /内容已变化/);
  const directory = path.join(root, 'tradewind', 'runs', workflowId, 'run-record');
  await fs.mkdir(path.join(directory, 'nodes', 'writer'), { recursive: true });
  await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({ workflowId,
    executionId: 'run-record', status: 'done', startTime: '2026-10-21T00:00:00Z' }));
  await fs.writeFile(path.join(directory, 'graph-snapshot.json'), JSON.stringify({ nodes: [{ id: 'writer', type: 'agent',
    label: '编辑', position: { x: 0, y: 0 }, config: { role: '编辑指南'.repeat(1000) } }], edges: [] }));
  await fs.writeFile(path.join(directory, 'nodes', 'writer', 'messages.json'), JSON.stringify([
    { role: 'system', content: 'private system' }, { role: 'user', content: '整理清单' },
    { role: 'assistant', content: '已整理', reasoningContent: 'private reasoning' },
    { role: 'tool', content: '发布结果', toolCallId: 'call-1' },
  ]));
  const detail = await invoke('read_workflow_run', { workflowId, executionId: 'run-record', maxChars: 25 }) as {
    text: string; nextOffset: number; revision: string;
  };
  assert.equal(detail.text.length, 25);
  assert.equal(detail.nextOffset, 25);
  await invoke('read_workflow_run', { workflowId, executionId: 'run-record', maxChars: 25,
    offset: detail.nextOffset, revision: detail.revision });
  await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify({ workflowId,
    executionId: 'run-record', status: 'failed', startTime: '2026-10-21T00:00:00Z' }));
  await assert.rejects(invoke('read_workflow_run', { workflowId, executionId: 'run-record',
    offset: detail.nextOffset, revision: detail.revision }), /内容已变化/);
  const archive = await invoke('read_workflow_run_archive', { workflowId, executionId: 'run-record',
    kind: 'node-context', nodeId: 'writer' }) as { text: string };
  assert.match(archive.text, /整理清单|已整理|发布结果/);
  assert.doesNotMatch(archive.text, /private|reasoningContent/);
  const archivePage = await invoke('read_workflow_run_archive', { workflowId, executionId: 'run-record',
    kind: 'node-context', nodeId: 'writer', maxChars: 10 }) as { nextOffset: number; revision: string };
  await assert.rejects(invoke('read_workflow_run_archive', { workflowId, executionId: 'run-record',
    kind: 'node-context', nodeId: 'writer', offset: archivePage.nextOffset }), /参数无效/);
  await fs.writeFile(path.join(directory, 'nodes', 'writer', 'messages.json'), JSON.stringify([
    { role: 'assistant', content: '后续工作已完成' },
  ]));
  await assert.rejects(invoke('read_workflow_run_archive', { workflowId, executionId: 'run-record',
    kind: 'node-context', nodeId: 'writer', offset: archivePage.nextOffset, revision: archivePage.revision }), /内容已变化/);
  await assert.rejects(invoke('read_workflow_run', { workflowId, executionId: 'run-record', offset: -1 }), /分页参数/);
});

test('新工具遵守 Agent 实时开关，人工关口和破坏性管理仍不开放', async t => {
  const { router } = await fixture(t);
  const enabled = ['list_workflow_profiles', 'save_workflow_profile', 'list_workflow_runs',
    'read_workflow_run', 'read_workflow_run_events', 'read_workflow_run_archive'];
  let tools = [...enabled];
  const gateway = new AgentCollaborationGateway(router, async () => ({ toolMode: 'selected', tools }));
  assert.deepEqual((await gateway.tools(identity)).map(item => item.name).sort(), enabled.sort());
  tools = [];
  await assert.rejects(gateway.invokeTool('list_workflow_runs', { workflowId: 'any' }, identity), /未启用/);
  for (const method of ['deleteWorkflow', 'submitHumanGate', 'readWorkflowRunEvent', 'saveWorkflowProfiles']) {
    await assert.rejects(gateway.invoke({ feature: 'tradewind', method, input: {} }, identity), /未向 Agent 开放/);
  }
});

test('循环档案不被交互模式或预留绝对节拍静默降级，拒绝时不创建运行且不干扰其他流程', async t => {
  const { root, invoke } = await fixture(t);
  const workflowId = await create(invoke);
  const admin = createTradewindWorkflowAdmin(root);
  await admin.saveProfiles(workflowId, [{ ...profile, cadence: { kind: 'absolute', by: 'tide' } }]);
  const otherWorkflow = await create(invoke, 'handoff');
  const catalog = await invoke('list_workflow_profiles', { workflowId: otherWorkflow }) as { revision: string };
  await invoke('save_workflow_profile', { workflowId: otherWorkflow,
    profile: { ...profile, cadence: { kind: 'relative', gapSec: 60 } }, expectedRevision: catalog.revision });
  await invoke('start_workflow', { workflowId: otherWorkflow, mode: 'auto', profileId: profile.id });
  for (const mode of [undefined, 'manual']) await assert.rejects(invoke('start_workflow', {
    workflowId, profileId: profile.id, ...(mode ? { mode } : {}),
  }), /显式选择 auto/);
  await assert.rejects(invoke('start_workflow', { workflowId, profileId: profile.id, mode: 'auto' }), /absolute\/tide.*尚不能启动/);
  await assert.rejects(fs.access(path.join(root, 'tradewind', 'runs', workflowId)));
  assert.equal(isTradewindExecutionRunning({ workflowId: otherWorkflow, dataDir: root }), true);
  const plain = await invoke('start_workflow', { workflowId }) as { loop?: true; executionId: string };
  assert.equal(plain.loop, undefined);
  assert.ok(plain.executionId);
});
