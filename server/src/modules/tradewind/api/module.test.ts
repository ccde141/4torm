import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { AgentToolOutput, type CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { createTradewindModule } from './module.js';
import type { TradewindCommands } from '../application/execution-commands.js';
import type { TradewindDesignPort } from '../application/design-port.js';

const context: CollaborationContext = {
  actor: { type: 'human', id: 'human', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['tradewind']), permissions: new Set(['observe']), requestId: 'req-1',
};

test('信风把工作流与内部工位投影为统一父子探针', async () => {
  const router = new CollaborationRouter([createTradewindModule({ source: {
    snapshots: async () => [{
      operationId: 'workflow-1', title: '发布流程', runId: 'execution-1',
      status: 'waiting', phase: 'human-gate', waitingReason: '等待 1 个人类关口',
    }, {
      operationId: 'node:workflow-1:review', parentOperationId: 'workflow-1',
      title: '审查', runId: 'execution-1', status: 'waiting', phase: 'human-gate',
      waitingReason: '等待人类提交',
    }],
  }, commands: commands() })]);
  const result = await router.observe('tradewind', { view: 'summary' }, context);
  assert.deepEqual(result.items, [{
    operationId: 'workflow-1', title: '发布流程', status: 'waiting',
    phase: 'human-gate', runId: 'execution-1', waitingReason: '等待 1 个人类关口',
  }, {
    operationId: 'node:workflow-1:review', parentOperationId: 'workflow-1',
    title: '审查', status: 'waiting', phase: 'human-gate', runId: 'execution-1',
    waitingReason: '等待人类提交',
  }]);
});

test('信风空闲时不伪造运行实体', async () => {
  const router = new CollaborationRouter([createTradewindModule({
    source: { snapshots: async () => [] }, commands: commands(),
  })]);
  const result = await router.observe('tradewind', {}, context);
  assert.deepEqual(result.items, []);
  assert.equal(result.completeness, 'complete');
});

test('信风启动与停止只能通过声明的中心命令口', async () => {
  const calls: string[] = [];
  const fake = commands({
    start: async input => {
      calls.push(`start:${input.workflowId}`);
      return { workflowId: input.workflowId, workflowName: '发布流程', executionId: 'exec-1', status: 'running' };
    },
    stop: async input => { calls.push(`stop:${input.executionId}`); return { stopped: true, executionId: 'exec-1' }; },
  });
  let started = false;
  const module = createTradewindModule({
    source: { snapshots: async () => started ? [{
      operationId: 'wf-1', title: '发布流程', runId: 'exec-1', status: 'running',
    }] : [] },
    commands: { ...fake, start: async input => { started = true; return fake.start(input, {
      type: 'human', id: 'human',
    }); } },
  });
  assert.deepEqual(Object.fromEntries(module.manifest.methods.map(method => [
    method.id, method.output.mode,
  ])), {
    startWorkflow: 'operation', stopWorkflow: 'inline',
    submitHumanGate: 'inline', abortNodeRound: 'inline', pauseNodeRound: 'inline',
    resumeNodeRound: 'inline', abortMeetingRound: 'inline', sendNodeMessage: 'inline',
  });
  const router = new CollaborationRouter([module]);
  const executable = { ...context, permissions: new Set(['observe', 'execute', 'intervene'] as const) };
  const receipt = await router.invoke({
    feature: 'tradewind', method: 'startWorkflow',
    input: { workflowId: 'wf-1', initialInput: '发布' },
  }, executable);
  const stopped = await router.invoke({
    feature: 'tradewind', method: 'stopWorkflow', input: { executionId: 'exec-1' },
  }, executable);
  assert.deepEqual(calls, ['start:wf-1', 'stop:exec-1']);
  assert.deepEqual(receipt, {
    operationId: 'wf-1', runId: 'exec-1',
    workflowId: 'wf-1', workflowName: '发布流程', executionId: 'exec-1', status: 'running',
  });
  assert.deepEqual(stopped, { stopped: true, executionId: 'exec-1' });
});

test('Agent 与人类通过同一个已保存工作流启动命令', async () => {
  const calls: string[] = [];
  let active = false;
  const router = new CollaborationRouter([createTradewindModule({
    source: { snapshots: async () => active ? [{
      operationId: 'wf-saved', title: '发布', runId: 'exec-2', status: 'running',
    }] : [] },
    commands: commands({ start: async input => {
      calls.push(input.workflowId);
      active = true;
      return { workflowId: input.workflowId, workflowName: '发布', executionId: 'exec-2', status: 'running' };
    } }),
  })]);
  const result = await router.invoke({ feature: 'tradewind', method: 'startWorkflow',
    input: { workflowId: 'wf-saved', initialInput: '开始发布' },
  }, { ...context, actor: { type: 'agent', id: 'agent-a', actingAs: 'human' }, audience: 'agent',
    permissions: new Set(['execute']),
  });
  assert.deepEqual(calls, ['wf-saved']);
  assert.ok(result instanceof AgentToolOutput);
  assert.equal((result.value as { executionId: string }).executionId, 'exec-2');
  assert.equal((result.meta?.workflowExecution as { executionId: string }).executionId, 'exec-2');
});

test('Agent 从模块端口按执行身份读取节点并复用人类发话命令', async () => {
  const calls: string[] = [];
  const router = new CollaborationRouter([createTradewindModule({
    source: { snapshots: async () => [] },
    commands: commands({ sendNodeMessage: async input => {
      calls.push(`send:${input.executionId}:${input.nodeId}:${input.message}`);
      return { accepted: true, nodeId: input.nodeId };
    } }),
    reads: {
      nodeStatuses: () => [], nodeStatus: () => ({}),
      nodeSnapshot: async () => ({}), meetingStatus: () => ({}),
      agentNodeConversation: async input => {
        calls.push(`read:${input.workflowId}:${input.executionId}:${input.nodeId}:${input.limit}`);
        return { messages: [], busy: false };
      },
      agentMeetingConversation: async input => {
        calls.push(`meeting:${input.executionId}:${input.nodeId}:${input.scope}:${input.limit}`);
        return { messages: [], busy: false };
      },
    },
  })]);
  const agent = { ...context, actor: { type: 'agent' as const, id: 'agent-a', actingAs: 'human' as const },
    audience: 'agent' as const, permissions: new Set(['observe' as const, 'intervene' as const]) };
  await router.invoke({ feature: 'tradewind', method: 'readAgentNodeConversation',
    input: { workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'writer' } }, agent);
  await router.invoke({ feature: 'tradewind', method: 'readAgentMeetingConversation',
    input: { workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'review', scope: 'chair' } }, agent);
  await router.invoke({ feature: 'tradewind', method: 'sendNodeMessage',
    input: { executionId: 'exec-1', nodeId: 'writer', message: '继续' } }, agent);
  assert.deepEqual(calls, [
    'read:wf-1:exec-1:writer:8', 'meeting:exec-1:review:chair:8',
    'send:exec-1:writer:继续',
  ]);
});

test('Agent 的信风搭建工具由模块端口统一提供', async () => {
  const calls: string[] = [];
  const router = new CollaborationRouter([createTradewindModule({
    source: { snapshots: async () => [] }, commands: commands(), design: designs(calls),
  })]);
  const agent = { ...context, actor: { type: 'agent' as const, id: 'agent-a', actingAs: 'human' as const },
    audience: 'agent' as const, permissions: new Set(['observe' as const, 'design' as const]) };
  await router.invoke({ feature: 'tradewind', method: 'listAgents', input: {} }, agent);
  await router.invoke({ feature: 'tradewind', method: 'createWorkflow',
    input: workflowInput('发布') }, agent);
  await router.invoke({ feature: 'tradewind', method: 'listWorkflows', input: {} }, agent);
  await router.invoke({ feature: 'tradewind', method: 'updateWorkflow',
    input: { workflowId: 'wf-a', expectedRevision: 'a'.repeat(64),
      ...workflowInput('发布2') } }, agent);
  assert.deepEqual(calls, ['agents', 'create', 'list', 'update:wf-a']);
});

test('节点与会议干预要求当前子轮次身份', async () => {
  const calls: string[] = [];
  const router = new CollaborationRouter([createTradewindModule({
    source: { snapshots: async () => [] },
    commands: commands({
      abortNodeRound: async input => {
        calls.push(`abort-node:${input.nodeId}:${input.runId}`);
        return { aborted: true, nodeId: input.nodeId, runId: input.runId };
      },
      pauseNodeRound: async input => {
        calls.push(`pause-node:${input.nodeId}:${input.runId}`);
        return { paused: true, nodeId: input.nodeId, runId: input.runId };
      },
      abortMeetingRound: async input => {
        calls.push(`abort-meeting:${input.nodeId}:${input.runId}`);
        return { aborted: true, nodeId: input.nodeId, runId: input.runId };
      },
    }),
  })]);
  const ctx = { ...context, permissions: new Set(['intervene'] as const) };
  await router.invoke({ feature: 'tradewind', method: 'abortNodeRound',
    input: { nodeId: 'writer', runId: 'node-round-1' } }, ctx);
  await router.invoke({ feature: 'tradewind', method: 'pauseNodeRound',
    input: { nodeId: 'writer', runId: 'node-round-2' } }, ctx);
  await router.invoke({ feature: 'tradewind', method: 'abortMeetingRound',
    input: { nodeId: 'review', runId: 'meeting-round-1' } }, ctx);
  assert.deepEqual(calls, [
    'abort-node:writer:node-round-1',
    'pause-node:writer:node-round-2',
    'abort-meeting:review:meeting-round-1',
  ]);
});

test('工作流级干预要求当前执行身份', async () => {
  const calls: string[] = [];
  const router = new CollaborationRouter([createTradewindModule({
    source: { snapshots: async () => [] },
    commands: commands({
      stop: async input => {
        calls.push(`stop:${input.executionId}`);
        return { stopped: true, executionId: input.executionId };
      },
      submitHumanGate: async input => {
        calls.push(`gate:${input.executionId}:${input.nodeId}`);
        return { accepted: true, nodeId: input.nodeId };
      },
      resumeNodeRound: async input => {
        calls.push(`resume:${input.executionId}:${input.nodeId}`);
        return { resumed: true, nodeId: input.nodeId };
      },
      sendNodeMessage: async input => {
        calls.push(`message:${input.executionId}:${input.nodeId}:${input.message}`);
        return { accepted: true, nodeId: input.nodeId };
      },
    }),
  })]);
  const ctx = { ...context, permissions: new Set(['intervene'] as const) };
  await router.invoke({ feature: 'tradewind', method: 'stopWorkflow',
    input: { executionId: 'exec-1' } }, ctx);
  await router.invoke({ feature: 'tradewind', method: 'submitHumanGate',
    input: { executionId: 'exec-1', nodeId: 'gate-1', content: '通过' } }, ctx);
  await router.invoke({ feature: 'tradewind', method: 'resumeNodeRound',
    input: { executionId: 'exec-1', nodeId: 'writer' } }, ctx);
  await router.invoke({ feature: 'tradewind', method: 'sendNodeMessage',
    input: { executionId: 'exec-1', nodeId: 'writer', message: '继续' } }, ctx);
  assert.deepEqual(calls, [
    'stop:exec-1', 'gate:exec-1:gate-1', 'resume:exec-1:writer',
    'message:exec-1:writer:继续',
  ]);
});

function commands(overrides: Partial<TradewindCommands> = {}): TradewindCommands {
  return {
    start: async input => ({
      workflowId: input.workflowId, workflowName: input.workflowId,
      executionId: 'exec-default', status: 'running',
    }),
    stop: async input => ({ stopped: true, executionId: input.executionId }),
    submitHumanGate: async input => ({ accepted: true, nodeId: input.nodeId }),
    abortNodeRound: async input => ({ aborted: true, ...input }),
    pauseNodeRound: async input => ({ paused: true, ...input }),
    resumeNodeRound: async input => ({ resumed: true, nodeId: input.nodeId }),
    abortMeetingRound: async input => ({ aborted: true, ...input }),
    sendNodeMessage: async input => ({ accepted: true, nodeId: input.nodeId }),
    ...overrides,
  };
}

function designs(calls: string[]): TradewindDesignPort {
  return {
    listAgentSummaries: async () => [],
    listAgents: async () => { calls.push('agents'); return '[]'; },
    createWorkflow: async () => { calls.push('create'); return 'created'; },
    listWorkflows: async () => { calls.push('list'); return '[]'; },
    updateWorkflow: async (workflowId) => { calls.push(`update:${workflowId}`); return 'updated'; },
  };
}

function workflowInput(name: string) {
  return { name, nodes: [
    { id: 'entry', type: 'entry', label: '入口' },
    { id: 'output', type: 'output', label: '输出' },
  ], edges: [{ source: 'entry', target: 'output' }] };
}
