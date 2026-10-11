import assert from 'node:assert/strict';
import test from 'node:test';
import { createCycloneFeature } from '../../modules/cyclone/public.js';
import { AgentCollaborationGateway } from './agent-gateway.js';
import { CollaborationRouter } from './router.js';

test('启用整张气旋能力卡时附带本功能区的执行跟进工具', async () => {
  const module = createCycloneFeature({ dataDir: 'unused-for-catalog' }).module;
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([module]), async () => ({
    toolMode: 'selected', tools: ['framework_capability_cyclone'],
  }));
  const names = (await gateway.tools({ agentId: 'main' })).map(tool => tool.name);
  for (const name of [
    'create_collaboration_group', 'read_collaboration_group', 'start_collaboration_round',
    'inspect_operation', 'wait_operation', 'find_operation_records', 'read_operation_record',
  ]) assert.ok(names.includes(name), `${name} 应随气旋能力开放`);
  await assert.rejects(() => gateway.invokeTool('inspect_operation', {
    feature: 'tradewind', operationId: 'wf-1', runId: 'run-1',
  }, { agentId: 'main' }), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
});
