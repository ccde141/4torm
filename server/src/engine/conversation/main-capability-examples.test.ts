import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createConvectionFeature } from '../../modules/convection/public.js';
import { createCycloneFeature } from '../../modules/cyclone/public.js';
import { createTideFeature } from '../../modules/tide/public.js';
import { createTradewindFeature } from '../../modules/tradewind/public.js';
import type { FrameworkCapabilityDescriptor } from '../../shared/framework-capability.js';
import { CollaborationRouter } from '../collaboration/router.js';
import { activeMainCapabilities, renderCapabilityRouter, renderMainCapabilityGuide } from './main-capabilities.js';

function createModules(dataDir: string) {
  return [createConvectionFeature({ dataDir }).module,
    createCycloneFeature({ dataDir }).module,
    createTradewindFeature({ dataDir }).module,
    createTideFeature({ dataDir }).module];
}

async function withModules(callback: (modules: ReturnType<typeof createModules>) => void | Promise<void>) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'capability-examples-'));
  try { await callback(createModules(dataDir)); }
  finally { await rm(dataDir, { recursive: true, force: true }); }
}

function definitions(descriptor: FrameworkCapabilityDescriptor, actions: string[]) {
  return actions.map(name => ({
    name, description: `${name} 当前定义`, parameters: { type: 'object' },
    frameworkCapability: descriptor,
  }));
}

test('功能岛二级示例引用公开操作，正文不混入三级目录或字段', async () => {
  await withModules(modules => {
    const bindings = new CollaborationRouter(modules).listAgentTools();
    for (const module of modules) {
      const descriptor = module.manifest.agentCapability;
      assert.ok(descriptor?.examples?.length, module.manifest.id);
      const island = bindings.filter(binding => binding.feature === module.manifest.id);
      const names = new Set(island.map(binding => binding.definition.name));
      const guide = renderMainCapabilityGuide(descriptor.id,
        bindings.map(binding => binding.definition), null);
      const catalog = bindings.map(binding => binding.definition);
      const publicGuide = renderMainCapabilityGuide(descriptor.id, [], null, undefined, { catalog });
      assert.ok(publicGuide.includes(descriptor.guidance));
      assert.doesNotMatch(publicGuide, /#### action:|input JSON Schema：/);
      assert.throws(() => renderMainCapabilityGuide(descriptor.id, [], null, undefined,
        { catalog, view: 'tools' }), /FRAMEWORK_GUIDE_UNAVAILABLE/);
      const index = renderMainCapabilityGuide(descriptor.id, catalog, null, undefined, { view: 'tools' });
      assert.ok(index.includes(island[0].definition.name));
      assert.doesNotMatch(index, /input JSON Schema：/);
      const detail = renderMainCapabilityGuide(descriptor.id, catalog, null, island[0].definition.name);
      assert.ok(detail.includes(JSON.stringify(island[0].definition.parameters ?? {})));
      const exampleAt = guide.indexOf('### 使用示例');
      assert.ok(exampleAt > guide.indexOf(descriptor.guidance), descriptor.id);
      assert.doesNotMatch(guide, /#### action:|input JSON Schema：|参数 JSON Schema：/);
      const exampleText = guide.slice(exampleAt, guide.indexOf('准备实际操作时', exampleAt));
      for (const example of descriptor.examples) {
        for (const action of example.actions) {
          assert.ok(names.has(action), `${descriptor.id}: ${action}`);
          assert.match(exampleText, new RegExp(`\\b${action}\\b`));
        }
      }
    }
  });
});

test('气旋重任务指南先派到固定工位，群聊只承载共同背景与交流', async () => {
  await withModules(modules => {
    const bindings = new CollaborationRouter(modules).listAgentTools();
    const guide = renderMainCapabilityGuide('cyclone',
      bindings.map(binding => binding.definition), null);
    assert.match(guide, /独立.*工位私聊/);
    assert.match(guide, /群聊.*共同背景/);
    assert.match(guide, /start_collaboration_seat_chat/);
    assert.match(guide, /read_collaboration_thread/);
    assert.match(guide, /read_collaboration_console/);
    assert.match(guide, /read_collaboration_seat_memory/);
    assert.match(guide, /记忆不代替真实运行状态/);
    assert.match(guide, /公告板/);
  });
});

test('二级展示协作示例，三级目录只列当前获准操作', async () => {
  await withModules(modules => {
    const descriptor = modules[0].manifest.agentCapability!;
    const defs = definitions(descriptor, [
      'list_discussions', 'create_discussion', 'read_discussion',
    ]);
    const guide = renderMainCapabilityGuide('convection', defs, null);
    assert.match(guide, /### 使用示例/);
    const index = renderMainCapabilityGuide('convection', defs, null, undefined, { view: 'tools' });
    assert.match(index, /- `read_discussion`/);
    assert.doesNotMatch(index, /start_discussion|### 使用示例|input JSON Schema/);
  });
});

test('能力指南展开操作示例，能力路由保留简短工作队分工例子', async () => {
  await withModules(modules => {
    const descriptor = modules[2].manifest.agentCapability!;
    const defs = [
      { name: 'framework_guide', description: 'guide', parameters: {} },
      { name: 'team_start', description: 'start', parameters: {} },
      { name: 'task_board', description: 'board', parameters: {} },
      ...definitions(descriptor, ['list_agents', 'create_workflow', 'list_workflows']),
    ];
    const route = renderCapabilityRouter(activeMainCapabilities(defs));
    assert.match(route, /两个互不依赖的模块各有测试/);
    assert.doesNotMatch(route, /### 使用示例|核对已保存的工作流结构/);
    const board = renderMainCapabilityGuide('board', defs, null);
    assert.match(board, /### 使用示例/);
    assert.match(board, /task_board/);
  });
});

test('工作队二级说明完整协作链，三级仅提供本轮真实工具', () => {
  const names = ['team_read', 'team_review', 'team_ack', 'team_dispatch'];
  const defs = names.map(name => ({ name, description: name, parameters: {} }));
  const guide = renderMainCapabilityGuide('team', defs, null);
  assert.match(guide, /### 使用示例[\s\S]*`team_read` → `team_review` → `team_ack` → `team_dispatch`/);
  const withoutAck = renderMainCapabilityGuide('team', defs.filter(def => def.name !== 'team_ack'), null,
    undefined, { view: 'tools' });
  assert.doesNotMatch(withoutAck, /team_ack|### 使用示例/);
});

test('同一功能岛的示例元数据漂移会被拒绝', async () => {
  await withModules(modules => {
    const descriptor = modules[0].manifest.agentCapability!;
    assert.throws(() => activeMainCapabilities([
      ...definitions(descriptor, ['list_discussions']),
      ...definitions({ ...descriptor, examples: [] }, ['read_discussion']),
    ]), /FRAMEWORK_CAPABILITY_DESCRIPTOR_CONFLICT/);
  });
});
