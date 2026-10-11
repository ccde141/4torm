import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentCollaborationTools } from './agent-collaboration-tools.js';
import { agentToolOutput } from '../collaboration/contracts.js';
import { AgentCollaborationGateway } from '../collaboration/agent-gateway.js';
import { CollaborationRouter } from '../collaboration/router.js';
import { createTradewindModule } from '../../modules/tradewind/public.js';
import { createSessionToolCaller } from './session-tool-dispatcher.js';
import { FileChangeLedger } from './file-change-ledger.js';

test('中心 Agent 工具保留模块 Schema 并跳过已有虚拟工具', async () => {
  const bridge = await AgentCollaborationTools.load(
    { agentId: 'agent-a', sessionId: 'session-a' },
    ['start_workflow'],
    {
      list: async () => [
        { name: 'start_workflow', description: '旧入口', parameters: { type: 'object' } },
        { name: 'create_collaboration', description: '创建协作组', parameters: {
          type: 'object', required: ['goal'], properties: { goal: { type: 'string' } },
        }, frameworkCapability: {
          id: 'cyclone', title: '气旋协作组', route: '建立持续协作结构。',
          guidance: '### 气旋协作组\n按协议建立协作组。',
        } },
      ],
      invoke: async () => null,
    },
  );

  assert.deepEqual(bridge.definitions, [{
    name: 'create_collaboration', description: '创建协作组', parameters: {
      type: 'object', required: ['goal'], properties: { goal: { type: 'string' } },
    }, frameworkCapability: {
      id: 'cyclone', title: '气旋协作组', route: '建立持续协作结构。',
      guidance: '### 气旋协作组\n按协议建立协作组。',
    },
  }]);
  assert.equal(bridge.handles('start_workflow'), false);
  assert.equal(bridge.handles('create_collaboration'), true);
});

test('同一功能岛的操作压缩为一个运行时超级工具', async () => {
  const descriptor = {
    id: 'tradewind', title: '信风工作流', route: '固定节点流转。',
    guidance: '### 信风工作流\n按协议使用。',
  };
  const bridge = await AgentCollaborationTools.load(
    { agentId: 'agent-a', sessionId: 'session-a' }, [],
    {
      list: async () => [
        { name: 'list_workflows', description: '列出工作流', parameters: { type: 'object' },
          frameworkCapability: descriptor },
        { name: 'start_workflow', description: '启动工作流', parameters: { type: 'object' },
          frameworkCapability: descriptor },
        { name: 'inspect_operation', description: '检查运行', parameters: { type: 'object' } },
      ],
      invoke: async () => null,
    },
  );

  assert.deepEqual(bridge.runtimeDefinitions.map(definition => definition.name), [
    'framework_capability_tradewind', 'inspect_operation',
  ]);
  assert.equal(bridge.runtimeDefinitions[0].frameworkCapability?.id, 'tradewind');
  assert.deepEqual(bridge.definitions.map(definition => definition.name), [
    'list_workflows', 'start_workflow', 'inspect_operation',
  ]);
});

test('超级工具只转发当前 Agent 获准且属于该能力的 action', async () => {
  const calls: unknown[] = [];
  const bridge = await AgentCollaborationTools.load(
    { agentId: 'agent-a', sessionId: 'session-a' }, [],
    {
      list: async () => [{
        name: 'start_workflow', description: '启动工作流', parameters: { type: 'object' },
        frameworkCapability: {
          id: 'tradewind', title: '信风工作流', route: '固定节点流转。', guidance: 'guide',
        },
      }],
      invoke: async (tool, input) => {
        calls.push({ tool, input });
        return { status: 'queued' };
      },
    },
  );

  assert.deepEqual(await bridge.call('framework_capability_tradewind', {
    action: 'start_workflow', input: { workflowId: 'wf-a' },
  }), { result: '{"status":"queued"}' });
  assert.deepEqual(calls, [{ tool: 'start_workflow', input: { workflowId: 'wf-a' } }]);
  assert.deepEqual(await bridge.call('framework_capability_tradewind', {
    action: 'start_workflow', input: '{"workflowId":"wf-b"}',
  }), { result: '{"status":"queued"}' });
  assert.deepEqual(calls[1], { tool: 'start_workflow', input: { workflowId: 'wf-b' } });
  await assert.rejects(() => bridge.call('framework_capability_tradewind', {
    action: 'delete_workflow', input: {},
  }), /FRAMEWORK_CAPABILITY_ACTION_UNAVAILABLE/);
});

test('中心 Agent 工具执行保留 Agent、会话和中止身份并返回有界 JSON', async () => {
  let received: unknown;
  const controller = new AbortController();
  const bridge = await AgentCollaborationTools.load(
    { agentId: 'agent-a', sessionId: 'session-a' }, [],
    {
      list: async () => [{
        name: 'create_collaboration', description: '创建协作组', parameters: { type: 'object' },
      }],
      invoke: async (tool, input, identity) => {
        received = { tool, input, identity };
        return { operationId: 'group-a', status: 'queued' };
      },
    },
  );

  assert.deepEqual(await bridge.call('create_collaboration', { goal: '审计' }, controller.signal), {
    result: '{"operationId":"group-a","status":"queued"}',
  });
  assert.deepEqual(received, {
    tool: 'create_collaboration', input: { goal: '审计' },
    identity: { agentId: 'agent-a', sessionId: 'session-a', signal: controller.signal },
  });
});

test('中心 Agent 工具将展示元数据与模型正文分别交给运行器', async () => {
  const bridge = await AgentCollaborationTools.load(
    { agentId: 'agent-a', sessionId: 'session-a' }, [],
    {
      list: async () => [{ name: 'create_draft', description: '创建草稿', parameters: {} }],
      invoke: async () => agentToolOutput(
        { taskId: 'task-a', enabled: false },
        { pendingAutomation: { taskId: 'task-a', enabled: false } },
      ),
    },
  );
  assert.deepEqual(await bridge.call('create_draft', {}), {
    result: '{"taskId":"task-a","enabled":false}',
    meta: { pendingAutomation: { taskId: 'task-a', enabled: false } },
  });
});

test('中心 Agent 工具不会吞掉网关错误或执行未知名称', async () => {
  const expected = new Error('CAPABILITY_DISABLED');
  const bridge = await AgentCollaborationTools.load(
    { agentId: 'agent-a' }, [],
    {
      list: async () => [{ name: 'known', description: '已知', parameters: { type: 'object' } }],
      invoke: async () => { throw expected; },
    },
  );
  await assert.rejects(() => bridge.call('known', {}), error => error === expected);
  await assert.rejects(() => bridge.call('unknown', {}), /AGENT_COLLABORATION_TOOL_UNKNOWN/);
});

test('真实超级工具启动回执经普通工具事件回到 Agent，关闭能力时如实报失败', async () => {
  let active = false;
  let enabled = true;
  const module = createTradewindModule({
    source: { snapshots: async () => active ? [{
      operationId: 'wf-a', title: '发布', status: 'running', runId: 'exec-a',
    }] : [] },
    commands: { start: async () => {
      active = true;
      return { workflowId: 'wf-a', workflowName: '发布', executionId: 'exec-a', status: 'running' };
    } } as never,
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: enabled ? ['start_workflow'] : [],
  }));
  const bridge = await AgentCollaborationTools.load({ agentId: 'agent-a', sessionId: 'session-a' }, [], {
    list: identity => gateway.tools(identity), invoke: (name, args, identity) =>
      gateway.invokeTool(name, args, identity),
  });
  const events: Array<{ type: string; ok?: boolean; result?: string; meta?: unknown }> = [];
  const caller = createSessionToolCaller({
    dataDir: 'unused', agentId: 'agent-a', model: 'provider:model', workspace: 'unused',
    sandboxLevel: 'project', signal: new AbortController().signal,
    sessionId: 'session-a', mainAgent: true, guideToolDefs: [], ledger: new FileChangeLedger(),
    setPendingRegistration: () => undefined, emit: event => events.push(event),
    extension: { definitions: bridge.runtimeDefinitions,
      call: (name, args, signal) => bridge.call(name, args, signal) },
  });
  const name = 'framework_capability_tradewind';
  const args = { action: 'start_workflow', input: '{"workflowId":"wf-a"}' };
  const result = await caller.call(name, args);
  assert.deepEqual(JSON.parse(result), { operationId: 'wf-a', runId: 'exec-a',
    workflowId: 'wf-a', workflowName: '发布', executionId: 'exec-a', status: 'running' });
  assert.deepEqual(events.map(event => [event.type, event.ok]),
    [['tool-call', undefined], ['tool-result', true]]);
  assert.deepEqual((events[1]?.meta as { workflowExecution?: { executionId?: string } })
    ?.workflowExecution?.executionId, 'exec-a');

  enabled = false;
  await assert.rejects(() => caller.call(name, args), /当前 Agent 未启用此框架能力/);
  assert.deepEqual(events.slice(2).map(event => [event.type, event.ok]),
    [['tool-call', undefined], ['tool-result', false]]);
});
