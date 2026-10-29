import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildConversationSystemPrompt } from './prompt-builder.js';
import { teamToolDefs } from './team/tools.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { withMainToolGuidance } from './main-tool-defs.js';
import {
  MAIN_CAPABILITIES, activeMainCapabilities, renderCapabilityRouter, renderMainCapabilityGuide,
} from './main-capabilities.js';
import { TIDE_META } from '../../modules/tide/public.js';

test('主入口能力登记保持唯一工具归属', () => {
  const ids = MAIN_CAPABILITIES.map(capability => capability.id);
  const tools = MAIN_CAPABILITIES.flatMap(capability => capability.tools);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(tools).size, tools.length);
});

test('主入口按能力集中注入，角色最后，两种协议保持分离', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'main-prompt-'));
  try {
    for (const native of [true, false]) {
      const prompt = await buildConversationSystemPrompt({
        mainAgent: true, rolePrompt: 'ROLE-END', toolDefs: [
          ...teamToolDefs(),
          { name: 'create_automation', description: '创建潮汐草稿', parameters: {} },
          { name: 'update_automation', description: '更新潮汐草稿', parameters: {} },
          { name: 'list_automations', description: '列出潮汐任务', parameters: {} },
          { name: 'list_agents', description: '列出可用 Agent', parameters: {} },
          { name: 'create_workflow', description: '创建信风工作流', parameters: {} },
          { name: 'list_workflows', description: '查看信风工作流', parameters: {} },
          { name: 'update_workflow', description: '更新信风工作流', parameters: {} },
          { name: 'start_workflow', description: '启动信风工作流', parameters: {},
            frameworkCapability: {
              id: 'tradewind', title: '信风工作流',
              route: '工作需要固定节点、上下游交接、人类关口或可重复执行的结构。',
              guidance: '### 信风工作流\n必须是 DAG。',
            } },
          { name: 'create_discussion', description: '创建对流会议', parameters: {} },
        ],
        workspace: 'workspace', workspaceAbs: root, projectDir: root,
        sandboxLevel: 'project', skillIds: [], dataDir: root, agentId: 'test',
        sessionId: 'session', native, allowDelegate: false,
      });
      assert.match(prompt, /你是 4torm 框架下的一个主 Agent/);
      assert.equal(prompt.split('## 4torm 框架导航').length - 1, 1);
      assert.ok(prompt.indexOf('## 4torm 框架导航') < prompt.indexOf('## 选择可用能力'));
      for (const entry of [
        'docs/guide/', 'docs/modes/', 'docs/architecture/', 'docs/extend/',
        'server/src/tools/framework/catalog.json', 'data/tools/registry.json',
        'data/tools/executors/', 'data/skills/', 'data/mcp/servers.json',
      ]) assert.match(prompt, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(prompt.split('## 选择可用能力').length - 1, 1);
      assert.match(prompt, /\*\*工作队\*\*：有一个可独立交付或复核的责任单元/);
      assert.match(prompt, /\*\*任务板\*\*：需要持续记录多个阶段与依赖/);
      assert.match(prompt, /\*\*协作总览\*\*：需要判断已有工作/);
      assert.match(prompt, /需要详细工作指南时调用 `framework_guide`/);
      assert.match(prompt, /`team` · \*\*工作队\*\*/);
      assert.match(prompt, /`tradewind` · \*\*信风工作流\*\*/);
      assert.match(prompt, /这些能力可以组合使用/);
      assert.equal(prompt.split('## 每轮工作形态检查').length - 1, 1);
      assert.match(prompt, /第一个实质动作前/);
      assert.match(prompt, /并行推进、上下文隔离、专业分工或独立复核/);
      assert.match(prompt, /共享文件、设备或外部状态/);
      assert.doesNotMatch(prompt, /GPU|\bbatch\b|\bubatch\b/);
      assert.ok(prompt.endsWith('ROLE-END'));
      assert.doesNotMatch(prompt, /默认热情|宁可多记|满足任一|\bdelegate\b|SubAgent|⟦/);
      assert.doesNotMatch(prompt, /在 `data\/mcp\/servers\.json` 追加/);
      for (const heading of ['### 信风工作流', '### 对流会议', '### 潮汐自动任务']) {
        assert.doesNotMatch(prompt, new RegExp(heading));
      }
      assert.equal(prompt.split('### 工作队协作').length - 1, 1);
      assert.match(prompt, /检查已有成员并优先考虑创建或复用/);
      assert.match(prompt, /一个可独立交付或复核的责任单元/);
      assert.doesNotMatch(prompt, /两个以上能够分别交付/);
      if (native) {
        assert.doesNotMatch(prompt, /JSON 调用信封|"type":"tool_call"|参数 JSON Schema/);
      } else {
        assert.match(prompt, /JSON 调用信封/);
        assert.match(prompt, /team_dispatch/);
        assert.match(prompt, /expectedRevision/);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('协作总览包含按时间检索并按 ID 分页读取历史执行的工具', () => {
  const defs = [
    { name: 'find_operation_records', description: '检索运行记录', parameters: {} },
    { name: 'read_operation_record', description: '读取运行记录', parameters: {} },
  ];
  const capabilities = activeMainCapabilities(defs);
  assert.deepEqual(capabilities.map(item => item.id), ['coordination']);
  const guide = renderMainCapabilityGuide('coordination', defs, null, undefined, { view: 'tools' });
  assert.match(guide, /find_operation_records/);
  assert.match(guide, /read_operation_record/);
  assert.match(renderMainCapabilityGuide('coordination', defs, null), /时间/);
});

test('关闭指南工具时能力路由不提示调用不存在的指南', () => {
  const active = activeMainCapabilities([{
    name: 'find_operation_records', description: '检索运行记录', parameters: {},
  }]);
  assert.deepEqual(active[0]?.tools, ['find_operation_records']);
  assert.doesNotMatch(renderCapabilityRouter(active), /调用 `framework_guide`/);
});

test('协作能力按真实开放状态给出具体选择和启动语义', () => {
  const convection = { id: 'convection', title: '对流会议',
    route: '需要公开讨论；创建会议与启动发言是不同动作。', guidance: '' };
  const tradewind = { id: 'tradewind', title: '信风工作流',
    route: '需要固定交接；搭建与启动分开。', guidance: '' };
  const defs = [
    { name: 'team_start', description: 'start', parameters: {} },
    { name: 'start_discussion', description: 'discuss', parameters: {},
      frameworkCapability: convection },
    { name: 'start_workflow', description: 'workflow', parameters: {},
      frameworkCapability: tradewind },
  ];
  const route = renderCapabilityRouter(activeMainCapabilities(defs));
  assert.match(route, /第一个实质动作前/);
  assert.match(route, /`team` · \*\*工作队\*\*：有一个可独立交付或复核的责任单元/);
  assert.match(route, /`convection`.*公开讨论/);
  assert.match(route, /`tradewind`.*搭建与启动分开/);
  assert.doesNotMatch(route, /`cyclone`|`tide`/);
  const withoutCollaboration = renderCapabilityRouter(activeMainCapabilities([{
    name: 'memory_read', description: 'read', parameters: {},
  }]));
  assert.doesNotMatch(withoutCollaboration, /第一个实质动作前|工作队|对流会议/);
});

test('中等任务路由给出可执行起手式，同时不推荐未开放的动作', () => {
  const tradewind = { id: 'tradewind', title: '信风工作流',
    route: '需要固定节点流转。', guidance: '遵守执行协议。' };
  const defs = [
    { name: 'framework_guide', description: 'guide', parameters: {} },
    { name: 'team_start', description: 'start', parameters: {} },
    { name: 'use_skill', description: 'skill', parameters: {} },
    { name: 'list_workflows', description: 'list', parameters: {}, frameworkCapability: tradewind },
  ];
  const route = renderCapabilityRouter(activeMainCapabilities(defs));
  assert.match(route, /中等任务.*一块.*独立.*team_start/s);
  assert.match(route, /两个.*独立.*验收.*默认.*team_start/s);
  assert.match(route, /例如.*两个互不依赖的模块各有测试.*不要只因源文件少/);
  assert.match(route, /单点.*强串行.*交接成本/);
  assert.match(route, /少量读取.*确认边界/);
  assert.match(route, /发现新的独立责任单元.*重新选择/);
  assert.match(route, /亲自修改前.*team_start/);
  assert.match(route, /不会.*争用同一文件或状态/);
  assert.match(route, /边界清楚.*可独立验收.*team_start/);
  assert.doesNotMatch(route, /起手：`team_start`/);
  assert.match(route, /team_start.*自己继续主线/);
  assert.match(route, /tradewind.*framework_guide.*tradewind/s);
  assert.match(route, /任务匹配时.*use_skill/);
  assert.doesNotMatch(route, /`cyclone`|`tide`/);

  const readOnly = renderCapabilityRouter(activeMainCapabilities([
    { name: 'team_read', description: 'read', parameters: {} },
  ]));
  assert.doesNotMatch(readOnly, /team_start|中等任务|启动成员|主动启动|亲自修改前/);
  assert.match(readOnly, /team_read/);
});

test('只开放工作队读取工具时不注入派工检查', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'main-team-readonly-'));
  try {
    const prompt = await buildConversationSystemPrompt({
      mainAgent: true, rolePrompt: '', toolDefs: [
        { name: 'team_read', description: 'read', parameters: {} },
      ], workspace: 'workspace', workspaceAbs: root, projectDir: root,
      sandboxLevel: 'project', skillIds: [], dataDir: root, agentId: 'a',
      sessionId: 's', native: true, allowDelegate: false,
    });
    assert.doesNotMatch(prompt, /每轮工作形态检查|team_start|优先考虑创建或复用/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('已启用技能能与协作形态组合，未启用时不出现主动加载提示', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'main-skill-route-'));
  try {
    for (const native of [true, false]) {
      const base = { mainAgent: true, rolePrompt: '', workspace: 'workspace',
        workspaceAbs: root, projectDir: root, sandboxLevel: 'project' as const,
        dataDir: root, agentId: 'a', sessionId: 's', native };
      const enabled = await buildConversationSystemPrompt({ ...base, skillIds: ['review'], toolDefs: [
        ...teamToolDefs(), { name: 'use_skill', description: 'review · 检查代码风险', parameters: {} },
      ] });
      assert.match(enabled, /技能.*协作形态.*组合/);
      assert.match(enabled, /任务匹配时.*use_skill/);
      const disabled = await buildConversationSystemPrompt({ ...base, skillIds: [], toolDefs: teamToolDefs() });
      assert.doesNotMatch(disabled, /任务匹配时.*use_skill/);
      const emptySkill = await buildConversationSystemPrompt({ ...base, skillIds: [], toolDefs: [
        ...teamToolDefs(), { name: 'use_skill', description: '空技能入口', parameters: {} },
      ] });
      assert.doesNotMatch(emptySkill, /`skill` ·|任务匹配时.*use_skill/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('功能岛能力元数据发生漂移时主入口拒绝静默合并', () => {
  const base = {
    id: 'tide', title: '潮汐自动任务', route: '按时间运行。', guidance: 'guide',
  };
  assert.throws(() => activeMainCapabilities([
    { name: 'create_automation', description: 'create', parameters: {},
      frameworkCapability: base },
    { name: 'list_automations', description: 'list', parameters: {},
      frameworkCapability: { ...base, title: '漂移标题' } },
  ]), /FRAMEWORK_CAPABILITY_DESCRIPTOR_CONFLICT/);
});

test('高级能力指南按当前可见工具单独加载，关闭后不能沿用旧知识', () => {
  const defs = [
    { name: 'framework_guide', description: 'guide', parameters: {} },
    ...teamToolDefs(),
  ];
  const guide = renderMainCapabilityGuide('team', defs, null);
  assert.match(guide, /### 工作队协作/);
  assert.match(guide, /team_start/);
  assert.match(guide, /team_dispatch/);
  assert.match(guide, /回报不会自动唤醒/);
  assert.throws(
    () => renderMainCapabilityGuide('workflow', defs, null),
    /FRAMEWORK_GUIDE_NOT_FOUND/,
  );
});

test('功能岛指南把细粒度定义表达为超级工具 action', () => {
  const descriptor = {
    id: 'tradewind', title: '信风工作流', route: '固定节点流转。', guidance: '信风协议。',
  };
  const guide = renderMainCapabilityGuide('tradewind', [{
    name: 'start_workflow', description: '启动工作流',
    parameters: { type: 'object', required: ['workflowId'] },
    frameworkCapability: descriptor,
  }], null, 'start_workflow');

  assert.match(guide, /framework_capability_tradewind/);
  assert.match(guide, /action.*start_workflow/s);
  assert.match(guide, /workflowId/);
  assert.doesNotMatch(guide, /直接调用 `start_workflow`/);
});

test('主入口只改工具说明，不改变名称、参数或其他入口定义', () => {
  const original = [...buildVirtualToolDefs(true, { allowDelegate: false }), {
    name: 'update_workflow', description: '旧说明',
    parameters: { type: 'object', properties: { workflowId: { type: 'string' } } },
  }];
  const snapshot = JSON.stringify(original);
  const main = withMainToolGuidance(original);
  assert.equal(JSON.stringify(original), snapshot);
  assert.deepEqual(main.map(tool => [tool.name, tool.parameters]), original.map(tool => [tool.name, tool.parameters]));
  assert.doesNotMatch(main.find(tool => tool.name === 'update_workflow')!.description, /先向用户确认/);
});

test('工作队缺席时不注入指导；共享调用方继承标记也不切换提示词', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'main-isolation-'));
  const opts = {
    mainAgent: true, rolePrompt: 'ROLE-END', toolDefs: [], workspace: 'workspace',
    workspaceAbs: root, projectDir: root, sandboxLevel: 'project' as const,
    skillIds: [], dataDir: root, agentId: 'test', native: true, allowDelegate: false,
  };
  try {
    const main = await buildConversationSystemPrompt({ ...opts, sessionId: 'session' });
    assert.doesNotMatch(main, /team_create|工作队协作|\*\*工作队\*\*|每轮工作形态检查/);
    const member = await buildConversationSystemPrompt({ ...opts, allowAsk: false });
    assert.doesNotMatch(member, /你是 4torm 框架下的一个主 Agent/);
    const tide = await buildConversationSystemPrompt({ ...opts, surfaceMeta: TIDE_META, allowAsk: false });
    assert.match(tide, /潮汐定时任务/);
    assert.doesNotMatch(tide, /你是 4torm 框架下的一个主 Agent/);
    const withoutSession = await buildConversationSystemPrompt({ ...opts });
    assert.doesNotMatch(withoutSession, /\*\*后台执行\*\*|\*\*潮汐自动任务\*\*/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
