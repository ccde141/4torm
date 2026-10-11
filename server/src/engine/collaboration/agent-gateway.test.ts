import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from './router.js';
import { AgentCollaborationGateway } from './agent-gateway.js';
import { createTradewindModule } from '../../modules/tradewind/public.js';

test('Agent 工具在执行时重新检查配置并保留 Agent 与会话身份', async () => {
  let received: { actorId?: string; requestId?: string } = {};
  let active = false;
  const module = createTradewindModule({
    source: { snapshots: async () => active ? [{
      operationId: 'wf-1', title: '发布', status: 'running', runId: 'exec-1',
    }] : [] },
    commands: {
      start: async (_input, actor) => {
        received = { actorId: actor.id, requestId: actor.sessionId };
        active = true;
        return receipt();
      },
      stop: async () => ({ stopped: true, executionId: 'exec-1' }),
      submitHumanGate: async input => ({ accepted: true, nodeId: input.nodeId }),
    },
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: ['start_workflow'],
  }));
  await gateway.invoke({ feature: 'tradewind', method: 'startWorkflow',
    input: { workflowId: 'wf-1' },
  }, { agentId: 'agent-a', sessionId: 'session-a' });
  assert.deepEqual(received, { actorId: 'agent-a', requestId: 'session-a' });
});

test('Agent 关闭工具后旧上下文的调用被中心门控拒绝', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: [],
  }));
  await assert.rejects(() => gateway.invoke({ feature: 'tradewind', method: 'startWorkflow',
    input: { workflowId: 'wf-1' },
  }, { agentId: 'agent-a', sessionId: 'session-a' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
});

test('Agent 能力定义由模块清单生成并按当前配置过滤', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  const selected = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: ['start_workflow'],
  }));
  const definitions = await selected.tools({ agentId: 'agent-a', sessionId: 'session-a' });
  const { frameworkCapability, ...definition } = definitions[0]!;
  assert.equal(frameworkCapability?.id, 'tradewind');
  assert.equal(frameworkCapability?.title, '信风工作流');
  assert.match(frameworkCapability?.guidance ?? '', /DAG/);
  assert.deepEqual(definition, {
    name: 'start_workflow',
    description: '启动一个已经保存的信风工作流。',
    parameters: {
      type: 'object', additionalProperties: false,
      required: ['workflowId'], properties: {
        workflowId: { type: 'string', minLength: 1 }, initialInput: { type: 'string' },
        mode: { enum: ['manual', 'auto'] }, profileId: { type: 'string' },
      },
    },
  });

  const disabled = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: [],
  }));
  assert.deepEqual(await disabled.tools({ agentId: 'agent-a' }), []);
});

test('Agent 可按工具名调用唯一的模块入口', async () => {
  let workflowId = '';
  let active = false;
  const module = createTradewindModule({
    source: { snapshots: async () => active ? [{
      operationId: 'wf-1', title: '发布', status: 'running', runId: 'exec-1',
    }] : [] },
    commands: {
      start: async input => {
        workflowId = input.workflowId;
        active = true;
        return receipt();
      },
    } as never,
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: ['start_workflow'],
  }));
  await gateway.invokeTool('start_workflow', { workflowId: 'wf-1' }, {
    agentId: 'agent-a', sessionId: 'session-a',
  });
  assert.equal(workflowId, 'wf-1');
});

test('Agent 调用所需工具由模块清单决定，不能由调用方替换', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: ['read_file'],
  }));
  await assert.rejects(() => gateway.invoke({
    feature: 'tradewind', method: 'startWorkflow', input: { workflowId: 'wf-1' },
  }, { agentId: 'agent-a', sessionId: 'session-a' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
});

test('没有声明 Agent 工具归属的底层调用口不会被网关开放', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'all', tools: [],
  }));
  await assert.rejects(() => gateway.invoke({
    feature: 'tradewind', method: 'stopWorkflow', input: {},
  }, { agentId: 'agent-a', sessionId: 'session-a' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'FEATURE_AGENT_METHOD_UNAVAILABLE');
});

test('Agent 能力清单只展示具备固定工具归属的高层调用口', () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  const router = new CollaborationRouter([module]);
  const manifests = router.listManifests({
    actor: { type: 'agent', id: 'agent-a', actingAs: 'human' }, audience: 'agent',
    enabledFeatures: new Set(['tradewind']), permissions: new Set([
      'observe', 'execute', 'intervene',
    ]), requestId: 'session-a',
  });
  assert.deepEqual(manifests[0]?.methods.map(method => method.id),
    ['startWorkflow', 'sendNodeMessage']);
  assert.equal(manifests[0]?.methods[0]?.agentTool?.name, 'start_workflow');
  assert.equal(manifests[0]?.methods[1]?.agentTool?.name, 'message_workflow_node');
});

test('可交互主 Agent 通过同一网关读取受预算限制的全局快照', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [{
      operationId: 'workflow-1', title: '发布', status: 'running', runId: 'exec-1',
    }] },
    commands: {} as never,
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: [],
  }));
  const snapshot = await gateway.snapshot({
    view: 'summary', limit: 10, maxTextChars: 2_000, maxTextLines: 40,
  }, { agentId: 'agent-a', sessionId: 'session-a' });
  assert.equal(snapshot.features[0]?.id, 'tradewind');
  assert.equal(snapshot.features[0]?.observation?.items[0]?.runId, 'exec-1');
});

test('Agent 可用中心工具精确读取一个运行句柄且仍受当前工具开关约束', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [{
      operationId: 'wf-1', title: '发布', status: 'running', runId: 'exec-1',
    }] }, commands: {} as never,
  });
  const enabled = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: ['inspect_operation'],
  }));
  assert.equal((await enabled.tools({ agentId: 'agent-a' }))
    .some(tool => tool.name === 'inspect_operation'), true);
  assert.deepEqual(await enabled.invokeTool('inspect_operation', {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1',
  }, { agentId: 'agent-a', sessionId: 'session-a' }), {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1',
    title: '发布', status: 'running',
  });

  const disabled = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: [],
  }));
  await assert.rejects(() => disabled.invokeTool('inspect_operation', {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1',
  }, { agentId: 'agent-a' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
});

test('Agent 用中心等待工具在状态变化后自动恢复且无需轮询', async () => {
  let status: 'running' | 'completed' = 'running';
  let notify = () => undefined;
  const module = createTradewindModule({
    source: {
      snapshots: async () => [{
        operationId: 'wf-1', title: '发布', status, runId: 'exec-1',
      }],
      subscribe: (_identity, listener) => {
        notify = listener;
        return () => undefined;
      },
    },
    commands: {} as never,
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: ['wait_operation'],
  }));
  const waiting = gateway.invokeTool('wait_operation', {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1', timeoutMs: 1_000,
  }, { agentId: 'agent-a', sessionId: 'session-a' });
  await new Promise(resolve => setImmediate(resolve));
  status = 'completed';
  notify();
  assert.deepEqual(await waiting, {
    feature: 'tradewind', operationId: 'wf-1', runId: 'exec-1',
    title: '发布', status: 'completed', timedOut: false,
  });
});

test('运行记录工具受 Agent 当前开关约束', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  module.manifest.operation!.records = true;
  module.records = { list: async () => [], read: async () => null };
  const router = new CollaborationRouter([module]);
  const enabled = new AgentCollaborationGateway(router, async () => ({
    toolMode: 'selected', tools: ['find_operation_records'],
  }));
  assert.equal((await enabled.tools({ agentId: 'main' }))
    .some(tool => tool.name === 'find_operation_records'), true);
  assert.deepEqual(await enabled.invokeTool('find_operation_records', {
    feature: 'tradewind',
  }, { agentId: 'main' }), { feature: 'tradewind', items: [], truncated: false });
  const disabled = new AgentCollaborationGateway(router, async () => ({
    toolMode: 'selected', tools: [],
  }));
  await assert.rejects(disabled.invokeTool('find_operation_records', {
    feature: 'tradewind',
  }, { agentId: 'main' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
});

test('功能岛不能占用中心协调工具名称', () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  module.manifest.methods.find(method => method.agentTool)!.agentTool = {
    name: 'inspect_operation', description: '冲突工具',
  };
  assert.throws(() => new AgentCollaborationGateway(
    new CollaborationRouter([module]), async () => ({ toolMode: 'all', tools: [] }),
  ), error => (error as { data?: { code?: string } }).data?.code === 'COORDINATION_TOOL_DUPLICATE');
});

function receipt() {
  return { workflowId: 'wf-1', workflowName: '发布', executionId: 'exec-1', status: 'running' as const };
}
