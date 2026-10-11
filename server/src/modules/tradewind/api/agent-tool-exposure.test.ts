import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { createTradewindFeature } from './factory.js';

test('真实信风功能装配将节点与会议工具注册到 Agent 网关并遵从开关', async () => {
  const feature = createTradewindFeature({ dataDir: 'unused-test-data-dir' });
  const router = new CollaborationRouter([feature.module]);
  let enabled = ['read_workflow_node', 'message_workflow_node',
    'read_workflow_meeting', 'speak_workflow_meeting'];
  const gateway = new AgentCollaborationGateway(router, async () => ({
    toolMode: 'selected', tools: enabled,
  }));
  const tools = await gateway.tools({ agentId: 'agent-a', sessionId: 'session-a' });
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...enabled].sort());
  const registered = router.listAgentTools().map(binding => binding.definition.name);
  for (const name of ['message_workflow_chair', 'end_workflow_meeting',
    'join_workflow_meeting', 'leave_workflow_meeting', 'reorder_workflow_meeting']) {
    assert.ok(registered.includes(name), `${name} should be registered`);
  }
  enabled = [];
  assert.deepEqual(await gateway.tools({ agentId: 'agent-a', sessionId: 'session-a' }), []);
  await assert.rejects(() => gateway.invokeTool('read_workflow_node', {
    workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'writer',
  }, { agentId: 'agent-a', sessionId: 'session-a' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
});
