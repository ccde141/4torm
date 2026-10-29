import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NodeRunner, type NodeRunnerEvent } from '../../../engine/tradewind/execution/node-runner.js';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { startTradewindExecution, stopActiveTradewindExecution } from '../../../services/tradewind-execution.js';
import { createTradewindCommands } from './control-adapter.js';
import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/index.js';

test('human and Agent node messages share one visible event and stable acknowledgement/snapshot identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-node-message-'));
  await fs.writeFile(path.join(root, 'providers.json'), JSON.stringify({ providers: [
    { id: 'test', baseUrl: 'https://node-message.test/v1', models: ['model'] },
  ] }));
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.ok(body.messages.every((message: Record<string, unknown>) => !('messageId' in message)
      && !('actor' in message) && !('nodeCompactionId' in message)));
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '已收到' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const graph: WorkflowGraph = { nodes: ['entry', 'human-gate', 'output'].map((type, index) => ({
    id: type, type, label: type, config: {}, position: { x: index * 100, y: 0 },
  })), edges: [
    { id: 'a', source: 'entry', sourcePort: 0, target: 'human-gate', targetPort: 0, kind: 'handoff' },
    { id: 'b', source: 'human-gate', sourcePort: 0, target: 'output', targetPort: 0, kind: 'handoff' },
  ] };
  const execution = await startTradewindExecution({ dataDir: root, workflowId: 'visibility', graph, trigger: { source: 'user' } });
  t.after(async () => { activeNodeRunners.delete('worker', execution.executionId);
    await stopActiveTradewindExecution(); await fs.rm(root, { recursive: true, force: true }); });
  const facts: Record<string, unknown>[] = [];
  const runner = new NodeRunner({ dataDir: root, workflowId: 'visibility', executionId: execution.executionId,
    nodeId: 'worker', agentId: 'worker', model: 'test:model', temperature: 0, toolNames: [], skillIds: [],
    workspace: root, sandboxLevel: 'project', systemPrompt: '简短答复', signal: new AbortController().signal,
    native: true, recordEvent: async (_type, payload) => { facts.push(payload); } });
  activeNodeRunners.set('worker', runner);
  for (const type of ['human', 'agent'] as const) {
    const events: NodeRunnerEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    let answeredSnapshot: ReturnType<NodeRunner['getSnapshot']> | undefined;
    let listening = false;
    const listener = (event: NodeRunnerEvent) => {
      if (!listening) return;
      events.push(event);
      if (event.type === 'answer') answeredSnapshot = runner.getSnapshot();
      if (event.type === 'done') finish();
    };
    runner.addEventListener(listener);
    listening = true;
    events.length = 0;
    const receipt = await createTradewindCommands(root).sendNodeMessage({ executionId: execution.executionId,
      nodeId: 'worker', message: `${type} 的工作指令` }, { type, id: `${type}-sender` });
    await done;
    await new Promise<void>(resolve => setImmediate(resolve));
    runner.removeEventListener(listener);
    const messages = events.filter(event => event.type === 'user-message');
    assert.equal(messages.length, 1, '打开中的各个窗口都必须收到发话正文');
    const visible = messages[0] as NodeRunnerEvent & { messageId?: string; actor?: { type: string } };
    assert.ok(visible.messageId);
    assert.equal((receipt as { messageId?: string }).messageId, visible.messageId);
    assert.equal(visible.actor?.type, type);
    assert.ok(answeredSnapshot?.messages.some(message => message.messageId === visible.messageId),
      'the answer/busy transition exposes committed history once terminal round replay is disabled');
    assert.equal(answeredSnapshot?.messages.at(-1)?.content, '已收到');
    const snapshot = runner.getSnapshot();
    assert.ok(snapshot.messages.some(message => message.messageId === visible.messageId)
      || snapshot.roundLog.some(event => event.type === 'user-message' && event.messageId === visible.messageId));
    assert.ok(facts.some(fact => fact.messageId === visible.messageId && (fact.actor as { type?: string })?.type === type));
  }
});
