import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildConversationSystemPrompt } from './prompt-builder.js';
import { teamToolDefs } from './team/tools.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { withMainToolGuidance } from './main-tool-defs.js';
import { MAIN_CAPABILITIES } from './main-capabilities.js';
import { TIDE_META } from '../../services/tide/meta.js';

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
        mainAgent: true, rolePrompt: 'ROLE-END', toolDefs: teamToolDefs(),
        workspace: 'workspace', workspaceAbs: root, projectDir: root,
        sandboxLevel: 'project', skillIds: [], dataDir: root, agentId: 'test',
        sessionId: 'session', native, allowDelegate: false,
      });
      assert.match(prompt, /你是 4torm 框架下的一个主 Agent/);
      assert.equal(prompt.split('## 选择可用能力').length - 1, 1);
      assert.match(prompt, /\*\*工作队\*\*：工作包含可分别验收的责任单元/);
      assert.match(prompt, /\*\*任务板\*\*：需要持续记录多个阶段与依赖/);
      assert.match(prompt, /这些能力可以组合使用/);
      assert.equal(prompt.split('## 每轮工作形态检查').length - 1, 1);
      assert.match(prompt, /第一个实质动作前/);
      assert.match(prompt, /并行推进、上下文隔离、专业分工或独立复核/);
      assert.match(prompt, /共享文件、设备或外部状态/);
      assert.doesNotMatch(prompt, /GPU|\bbatch\b|\bubatch\b/);
      assert.ok(prompt.endsWith('ROLE-END'));
      assert.doesNotMatch(prompt, /默认热情|宁可多记|满足任一|\bdelegate\b|SubAgent|⟦/);
      for (const heading of ['### 信风工作流', '### 潮汐自动任务', '### 工作队协作']) {
        assert.equal(prompt.split(heading).length - 1, 1);
      }
      assert.match(prompt, /team_dispatch/);
      assert.match(prompt, /优先考虑创建或复用工作队/);
      assert.match(prompt, /回报不会自动唤醒/);
      assert.match(prompt, /回报证据不足时，向原成员继续派工追问/);
      assert.match(prompt, /expectedRevision/);
      if (native) assert.doesNotMatch(prompt, /JSON 调用信封|"type":"tool_call"/);
      else assert.match(prompt, /JSON 调用信封/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('主入口只改工具说明，不改变名称、参数或其他入口定义', () => {
  const original = buildVirtualToolDefs(true, true, true, { allowDelegate: false });
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
