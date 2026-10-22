import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import type { TradewindCommands } from '../application/execution-commands.js';
import { createTradewindModule } from './module.js';

const agent: CollaborationContext = {
  actor: { type: 'agent', id: 'coordinator', actingAs: 'human' }, audience: 'agent',
  enabledFeatures: new Set(['tradewind']), permissions: new Set(['intervene']), requestId: 'request',
};

function fixture() {
  const calls: string[] = [];
  const commands: TradewindCommands = {
    start: async input => ({ workflowId: input.workflowId, workflowName: 'test', executionId: 'exec', status: 'running' }),
    stop: async input => { calls.push(`stop:${input.executionId}`); return { stopped: true, ...input }; },
    submitHumanGate: async input => { calls.push('gate'); return { accepted: true, nodeId: input.nodeId }; },
    abortNodeRound: async input => { calls.push(`abort:${input.executionId}:${input.nodeId}:${input.runId}`); return { aborted: true, ...input }; },
    pauseNodeRound: async input => { calls.push(`pause:${input.executionId}:${input.nodeId}:${input.runId}`); return { paused: true, ...input }; },
    resumeNodeRound: async input => { calls.push(`resume:${input.executionId}:${input.nodeId}:${input.runId}`); return { resumed: true, nodeId: input.nodeId }; },
    abortMeetingRound: async input => { calls.push('meeting'); return { aborted: true, ...input }; },
    sendNodeMessage: async input => ({ accepted: true, nodeId: input.nodeId }),
  };
  const router = new CollaborationRouter([createTradewindModule({ source: { snapshots: async () => [] }, commands })]);
  return { calls, router };
}

test('信风 Agent 控制工具声明精确执行与轮次，不开放人工关口和会议中止', async () => {
  const { router, calls } = fixture();
  const tools = router.listAgentTools();
  for (const name of ['abort_workflow_node_round', 'pause_workflow_node_round', 'resume_workflow_node_round']) {
    const definition = tools.find(tool => tool.definition.name === name)!.definition;
    assert.deepEqual(definition.parameters.required, ['executionId', 'nodeId', 'runId']);
  }
  assert.equal(router.resolveAgentTool('stop_workflow').method, 'stopWorkflow');
  for (const method of ['submitHumanGate', 'abortMeetingRound']) {
    await assert.rejects(router.invoke({ feature: 'tradewind', method,
      input: { executionId: 'exec', nodeId: 'writer', runId: 'round' } }, agent), /不向当前调用方开放/);
  }
  assert.deepEqual(calls, []);
});

test('Agent 控制返回已接受请求，禁止缺失执行/轮次身份且兼容人类旧输入', async () => {
  const { router, calls } = fixture();
  const input = { executionId: 'exec', nodeId: 'writer', runId: 'round' };
  for (const [method, action] of [['abortNodeRound', 'abort'], ['pauseNodeRound', 'pause'], ['resumeNodeRound', 'resume']]) {
    assert.deepEqual(await router.invoke({ feature: 'tradewind', method, input }, agent), {
      accepted: true, action, ...input,
    });
    await assert.rejects(router.invoke({ feature: 'tradewind', method,
      input: { nodeId: 'writer', runId: 'round' } }, agent), /参数无效/);
    await assert.rejects(router.invoke({ feature: 'tradewind', method,
      input: { executionId: 'exec', nodeId: 'writer' } }, agent), /参数无效/);
  }
  assert.deepEqual(calls, ['abort:exec:writer:round', 'pause:exec:writer:round', 'resume:exec:writer:round']);
  const human = { ...agent, actor: { type: 'human' as const, id: 'human', actingAs: 'human' as const }, audience: 'human' as const };
  await router.invoke({ feature: 'tradewind', method: 'pauseNodeRound', input: { nodeId: 'writer', runId: 'round' } }, human);
  await router.invoke({ feature: 'tradewind', method: 'resumeNodeRound', input: { executionId: 'exec', nodeId: 'writer' } }, human);
});

test('撤销信风能力或干预权限后，同一 Agent 的控制立即失效且无副作用', async () => {
  const { router, calls } = fixture();
  for (const method of ['stopWorkflow', 'abortNodeRound', 'pauseNodeRound', 'resumeNodeRound']) {
    const input = { executionId: 'exec', nodeId: 'writer', runId: 'round' };
    await assert.rejects(router.invoke({ feature: 'tradewind', method, input }, {
      ...agent, enabledFeatures: new Set(),
    }), /未启用/);
    await assert.rejects(router.invoke({ feature: 'tradewind', method, input }, {
      ...agent, permissions: new Set(['observe']),
    }), /没有执行此操作的权限/);
  }
  assert.deepEqual(calls, []);
});
