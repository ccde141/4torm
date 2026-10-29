import assert from 'node:assert/strict';
import test from 'node:test';
import { executeFrameworkGuideTool } from './framework-guide-tool.js';
import { teamToolDefs } from './team/tools.js';

const base = {
  mainAgent: true, dataDir: '.', agentId: 'agent-a', sessionId: 'session-a',
  args: { capability: 'team' },
};

test('工作指南可独立读取，实际工具定义仍要求当前开放', () => {
  const enabled = executeFrameworkGuideTool({ ...base, toolDefs: teamToolDefs() });
  assert.equal(enabled.ok, true);
  assert.match(enabled.result, /### 工作队协作/);

  const disabled = executeFrameworkGuideTool({ ...base, toolDefs: [] });
  assert.equal(disabled.ok, true);
  assert.match(disabled.result, /### 工作队协作/);
  assert.doesNotMatch(disabled.result, /参数 JSON Schema/);
  const tools = executeFrameworkGuideTool({ ...base, args: { capability: 'team', view: 'tools' }, toolDefs: [] });
  assert.equal(tools.ok, false);
  assert.match(tools.result, /该能力当前未开放/);
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
  const guide = executeFrameworkGuideTool({ ...base, args: { capability: 'cyclone' }, toolDefs: defs });
  assert.equal(guide.ok, true);
  assert.match(guide.result, /由人类执行删除与重置/);
  assert.doesNotMatch(guide.result, /marker|#### action:|list_collaboration_groups/);
  const index = executeFrameworkGuideTool({ ...base, args: { capability: 'cyclone', view: 'tools' }, toolDefs: defs });
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

test('二级读取只返回所选功能区，不带目录或字段，三级不能借公开目录越权', () => {
  const guideCatalog = ['convection', 'tradewind', 'cyclone', 'tide'].map(id => ({
    name: `${id}_action`, description: `${id} 操作`, parameters: { type: 'object', properties: { privateMarker: { type: 'string' } } },
    frameworkCapability: { id, title: id, route: `${id} 入口`, guidance: `${id} 独立指南正文` },
  }));
  for (const definition of guideCatalog) {
    const capability = definition.frameworkCapability.id;
    const guide = executeFrameworkGuideTool({ ...base, args: { capability }, guideCatalog, toolDefs: [] });
    assert.equal(guide.ok, true);
    assert.match(guide.result, new RegExp(`${capability} 独立指南正文`));
    assert.doesNotMatch(guide.result, /privateMarker|JSON Schema|#### action:/);
    for (const other of guideCatalog.filter(item => item !== definition)) {
      assert.ok(!guide.result.includes(other.frameworkCapability.guidance));
    }
    const denied = executeFrameworkGuideTool({ ...base, args: { capability, view: 'tools' }, guideCatalog, toolDefs: [] });
    assert.equal(denied.ok, false);
    assert.match(denied.result, /该能力当前未开放/);
  }
});

test('指南拒绝未知视图、冲突参数及未知功能区', () => {
  for (const args of [{ capability: 'team', view: 'unknown' },
    { capability: 'team', view: 'guide', action: 'team_start' }]) {
    const result = executeFrameworkGuideTool({ ...base, args, toolDefs: teamToolDefs() });
    assert.equal(result.ok, false);
    assert.match(result.result, /FRAMEWORK_GUIDE_INPUT_INVALID/);
  }
  const unknown = executeFrameworkGuideTool({ ...base, args: { capability: 'unknown' }, guideCatalog: [], toolDefs: [] });
  assert.equal(unknown.ok, false);
  assert.match(unknown.result, /未找到该功能区/);
});
