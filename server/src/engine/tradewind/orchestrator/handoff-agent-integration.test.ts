import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';
import type { WorkflowGraph, NodeExecutor } from '../foundation/types/index.js';
import { AgentExecutor, activeNodeRunners } from '../nodes/agent.js';
import { EntryExecutor } from '../nodes/entry.js';
import { OutputExecutor } from '../nodes/output.js';
import { Orchestrator } from './orchestrator.js';

test('真实 AgentExecutor→NodeRunner→模型翻译层的 native/text 双入口逐封交接', { timeout: 10_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-real-agent-handoff-'));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { name: '制作员', model: 'test:model', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const provider = { id: 'test', baseUrl: 'https://handoff.test/v1', models: ['model'] };
  let textMode = false;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests++;
    const body = JSON.parse(String(init.body));
    assert.match(body.messages[0].content, /当前岗位任务/);
    assert.match(body.messages[0].content, /按收到的产品资料整理交付/);
    assert.match(body.messages[0].content, /不能广播、分裂/);
    assert.equal(!!body.tools?.length, !textMode);
    const note = body.messages.filter((item: { role: string }) => item.role === 'user').at(-1).content;
    const args = { targetNodeId: 'output', note };
    const delta = textMode ? { content: JSON.stringify({ type: 'tool_call', name: 'complete_task', arguments: args }) }
      : { tool_calls: [{ index: 0, id: `seal-${requests}`, type: 'function',
        function: { name: 'complete_task', arguments: JSON.stringify(args) } }] };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: textMode ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const graph: WorkflowGraph = { orchestration: 'handoff', nodes: ['input-a', 'input-b', 'worker', 'output'].map(id => ({
    id, type: id.startsWith('input') ? 'entry' : id === 'worker' ? 'agent' : 'output', label: id,
    position: { x: 0, y: 0 }, config: id === 'worker' ? { agentId: 'worker', role: '按收到的产品资料整理交付' } : { initialEnvelope: id },
  })), edges: [['input-a', 'worker'], ['input-b', 'worker'], ['worker', 'output']].map(([source, target]) => ({
    id: `${source}-${target}`, source, target, sourcePort: 0, targetPort: 0, kind: 'handoff',
  })) };
  for (textMode of [false, true]) {
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
      ...(textMode ? { toolTransports: { model: { status: 'text-required', checkedAt: 'now',
        fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } } } : {}),
    }] }));
    const executors = new Map<string, NodeExecutor>([['entry', new EntryExecutor()], ['output', new OutputExecutor()], ['agent', new AgentExecutor()]]);
    const execution = new Orchestrator({ graph: structuredClone(graph), dataDir, workflowId: `wf-${textMode ? 'text' : 'native'}`, executors, mode: 'auto' });
    t.after(() => execution.stop());
    await execution.start();
    assert.equal(await execution.whenSettled(), 'done');
    const outputs = JSON.parse(await fs.readFile(path.join(execution.getRunDir(), 'output.json'), 'utf8'));
    assert.equal(outputs.length, 2);
    assert.equal(new Set(outputs.map((item: { envelopeId: string }) => item.envelopeId)).size, 2);
    assert.match(outputs[0].content, /input-a/);
    assert.match(outputs[1].content, /input-b/);
    assert.equal(activeNodeRunners.get('worker', execution.getExecutionId()), undefined);
  }
  assert.equal(requests, 4, '每个 root 仅一次模型调用，无费用、无后台重试');
});
