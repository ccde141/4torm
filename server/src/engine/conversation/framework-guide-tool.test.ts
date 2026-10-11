import assert from 'node:assert/strict';
import test from 'node:test';
import { executeFrameworkGuideTool } from './framework-guide-tool.js';
import { teamToolDefs } from './team/tools.js';

const base = {
  mainAgent: true, dataDir: '.', agentId: 'agent-a', sessionId: 'session-a',
  args: { capability: 'team' },
};

test('框架指南只展开当前真实可用能力', () => {
  const enabled = executeFrameworkGuideTool({ ...base, toolDefs: teamToolDefs() });
  assert.equal(enabled.ok, true);
  assert.match(enabled.result, /### 工作队协作/);

  const disabled = executeFrameworkGuideTool({ ...base, toolDefs: [] });
  assert.deepEqual(disabled, {
    result: '能力指南读取失败：该能力当前未开放。', ok: false,
  });
});

test('非主入口不能借框架指南取得能力协议', () => {
  assert.equal(executeFrameworkGuideTool({
    ...base, mainAgent: false, toolDefs: teamToolDefs(),
  }).ok, false);
});

test('分层能力指南先列操作，再仅展开请求的 action 字段', () => {
  const descriptor = { id: 'cyclone', title: '气旋', route: '持续协作', guidance: '由人类执行删除与重置。', actionGuide: true };
  const defs = ['list_collaboration_groups', 'start_collaboration_round'].map(name => ({
    name, description: `${name} 用途`, frameworkCapability: descriptor,
    parameters: { type: 'object', properties: { marker: { type: 'string' } } },
  }));
  const index = executeFrameworkGuideTool({ ...base, args: { capability: 'cyclone' }, toolDefs: defs });
  assert.equal(index.ok, true);
  assert.match(index.result, /list_collaboration_groups/);
  assert.doesNotMatch(index.result, /marker/);
  const detail = executeFrameworkGuideTool({ ...base, args: {
    capability: 'cyclone', action: 'start_collaboration_round',
  }, toolDefs: defs });
  assert.equal(detail.ok, true);
  assert.match(detail.result, /marker/);
  assert.doesNotMatch(detail.result, /#### action: list_collaboration_groups/);
  assert.equal(executeFrameworkGuideTool({ ...base, args: {
    capability: 'cyclone', action: 'delete_collaboration_group',
  }, toolDefs: defs }).ok, false);
});
