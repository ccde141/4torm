import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from '../collaboration/router.js';
import { AgentCollaborationGateway, configureAgentCollaborationGateway }
  from '../collaboration/agent-gateway.js';
import { createTradewindModule } from '../../modules/tradewind/public.js';
import { executeFrameworkGuideTool } from './framework-guide-tool.js';

test('真实功能岛的二级指南可在关闭权限时发现，读取不执行任务且三级继续拒绝', async () => {
  let invoked = 0;
  const module = createTradewindModule({
    source: { snapshots: async () => { invoked++; return []; } },
    commands: {
      start: async () => { invoked++; throw new Error('SHOULD_NOT_EXECUTE'); },
      stop: async () => { invoked++; throw new Error('SHOULD_NOT_EXECUTE'); },
      submitHumanGate: async () => { invoked++; throw new Error('SHOULD_NOT_EXECUTE'); },
    },
  });
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]),
    async () => ({ toolMode: 'selected', tools: [] }));
  configureAgentCollaborationGateway(gateway);
  const input = { mainAgent: true, dataDir: '.', agentId: 'agent-fixture',
    sessionId: 'session-fixture', toolDefs: [], args: { capability: 'tradewind' } };
  assert.deepEqual(await gateway.tools({ agentId: input.agentId }), []);
  const guide = executeFrameworkGuideTool(input);
  assert.equal(guide.ok, true);
  assert.ok(guide.result.includes(module.manifest.agentCapability!.guidance));
  assert.doesNotMatch(guide.result, /#### action:|input JSON Schema/);
  for (const args of [{ capability: 'tradewind', view: 'tools' },
    { capability: 'tradewind', action: 'start_workflow' }]) {
    const denied = executeFrameworkGuideTool({ ...input, args });
    assert.equal(denied.ok, false);
    assert.match(denied.result, /该能力当前未开放/);
  }
  await assert.rejects(gateway.invokeTool('start_workflow', { workflowId: 'workflow-fixture' },
    { agentId: input.agentId }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
  assert.equal(invoked, 0);
});
