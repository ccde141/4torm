import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildConversationSystemPrompt } from './prompt-builder.js';
import { teamToolDefs } from './team/tools.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { withMainToolGuidance } from './main-tool-defs.js';
import { TIDE_META } from '../../services/tide/meta.js';

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
      assert.ok(prompt.endsWith('ROLE-END'));
      assert.doesNotMatch(prompt, /默认热情|宁可多记|满足任一|必须 delegate|SubAgent|⟦/);
      for (const heading of ['### 信风工作流', '### 潮汐自动任务', '### 工作队协作']) {
        assert.equal(prompt.split(heading).length - 1, 1);
      }
      assert.match(prompt, /team_dispatch/);
      assert.match(prompt, /收益明确时，自主创建或复用成员/);
      assert.match(prompt, /调查开始、遇到不确定性或执行过程中/);
      assert.match(prompt, /无需为了协作而拆分简单工作/);
      assert.match(prompt, /回报不会自动唤醒/);
      assert.match(prompt, /自己验证一条假设，同时让成员独立验证另一条/);
      assert.match(prompt, /回报证据不足时，向原成员继续派工追问/);
      assert.match(prompt, /构建或长时间检查已在后台运行时/);
      assert.match(prompt, /调查、实现和验证三个阶段/);
      assert.match(prompt, /调查结果需要依次经过专业处理、人类确认和最终输出/);
      assert.match(prompt, /每天汇总一次状态，或定期检查某项外部变化/);
      assert.match(prompt, /确认某项项目约定会影响以后会话时/);
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
    assert.doesNotMatch(main, /team_create|工作队协作|成员回报|收益明确时，自主创建或复用成员/);
    const member = await buildConversationSystemPrompt({ ...opts, allowAsk: false });
    assert.doesNotMatch(member, /你是 4torm 框架下的一个主 Agent/);
    const tide = await buildConversationSystemPrompt({ ...opts, surfaceMeta: TIDE_META, allowAsk: false });
    assert.match(tide, /潮汐定时任务/);
    assert.doesNotMatch(tide, /你是 4torm 框架下的一个主 Agent/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('没有会话能力时不注入后台与潮汐示例', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'main-examples-'));
  try {
    const prompt = await buildConversationSystemPrompt({
      mainAgent: true, rolePrompt: '', toolDefs: [], workspace: 'workspace', workspaceAbs: root,
      projectDir: root, sandboxLevel: 'project', skillIds: [], dataDir: root, agentId: 'test',
      native: true, allowDelegate: false,
    });
    assert.doesNotMatch(prompt, /构建或长时间检查已在后台运行时/);
    assert.doesNotMatch(prompt, /每天汇总一次状态，或定期检查某项外部变化/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
