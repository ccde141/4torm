import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildConversationSystemPrompt, type PromptBuildOpts } from './prompt-builder.js';
import { executeFrameworkGuideTool } from './framework-guide-tool.js';
import {
  MAIN_ADVANCED_CAPABILITIES, MAIN_CAPABILITY_GUIDANCE, MAIN_TEAM,
} from './main-guidance.js';
import { teamToolDefs } from './team/tools.js';
import { buildVirtualToolDefs } from './virtual-tools.js';

async function isolated(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'monsoon-resident-'));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function options(root: string, native: boolean): PromptBuildOpts {
  return {
    mainAgent: true, rolePrompt: 'ROLE-END', toolDefs: teamToolDefs(),
    workspace: '.', workspaceAbs: root, projectDir: root, sandboxLevel: 'project',
    skillIds: [], dataDir: root, agentId: 'agent-fixture', sessionId: 'session-fixture',
    native, allowDelegate: false,
  };
}

function assertOnce(prompt: string, text: string): void {
  assert.equal(prompt.split(text).length - 1, 1);
}

test('季风完整工作队与基础使用规则常驻，两种协议保持原工具定义', async () => {
  await isolated(async root => {
    for (const native of [true, false]) {
      const opts = options(root, native);
      const definitions = structuredClone(opts.toolDefs);
      const prompt = await buildConversationSystemPrompt(opts);
      assertOnce(prompt, MAIN_TEAM);
      for (const id of ['ask', 'background', 'board', 'memory'] as const) {
        assertOnce(prompt, MAIN_CAPABILITY_GUIDANCE[id]);
      }
      assertOnce(prompt, '## 季风本会话能力');
      assertOnce(prompt, '## 每轮工作形态检查');
      assert.ok(prompt.endsWith('ROLE-END'));
      assert.deepEqual(opts.toolDefs, definitions);
      if (native) {
        assert.doesNotMatch(prompt, /参数 JSON Schema：|JSON 调用信封|"type":"tool_call"/);
        assert.match(prompt, /team_dispatch/);
      } else {
        assert.match(prompt, /JSON 调用信封/);
        for (const definition of definitions) {
          assert.match(prompt, new RegExp(`#### ${definition.name}\\n`));
          assert.ok(prompt.includes(JSON.stringify(definition.parameters)));
        }
      }
    }
  });
});

test('四区一级认知始终常驻，未开放的三级操作仍被拒绝', async () => {
  await isolated(async root => {
    const opts = options(root, true);
    const prompt = await buildConversationSystemPrompt(opts);
    assertOnce(prompt, MAIN_ADVANCED_CAPABILITIES);
    for (const area of ['convection', 'tradewind', 'cyclone', 'tide']) {
      assert.ok(prompt.includes(`（${area}）`));
      const result = executeFrameworkGuideTool({
        mainAgent: true, dataDir: root, agentId: opts.agentId, sessionId: opts.sessionId,
        args: { capability: area, view: 'tools' }, toolDefs: [
          ...buildVirtualToolDefs(true, { allowDelegate: false, allowFrameworkStatus: true }),
          ...opts.toolDefs,
        ],
      });
      assert.equal(result.ok, false, area);
      assert.match(result.result, /该能力当前未开放/);
    }
    assert.equal(MAIN_ADVANCED_CAPABILITIES.split('例如').length - 1, 4);
    assert.match(MAIN_ADVANCED_CAPABILITIES, /协作图.*分组.*联络、派发关系/);
    assert.match(MAIN_ADVANCED_CAPABILITIES, /尚未开放.*人类/);
    assert.doesNotMatch(prompt, /#### action:|framework_capability_cyclone|start_collaboration_seat_chat|update_collaboration_structure/);
  });
});

test('工作队缺少执行工具时不注入完整派工规则', async () => {
  await isolated(async root => {
    for (const native of [true, false]) {
      for (const toolDefs of [[], teamToolDefs().filter(tool => tool.name === 'team_read')]) {
        const prompt = await buildConversationSystemPrompt({ ...options(root, native), toolDefs });
        assert.ok(!prompt.includes(MAIN_TEAM));
        assert.doesNotMatch(prompt, /### 工作队协作|## 每轮工作形态检查|team_start|team_create|team_dispatch/);
        if (toolDefs.length) assert.match(prompt, /team_read/);
        assertOnce(prompt, MAIN_ADVANCED_CAPABILITIES);
      }
    }
  });
});

test('关闭询问入口后不常驻询问规则，其他本会话规则继续提供', async () => {
  await isolated(async root => {
    const prompt = await buildConversationSystemPrompt({ ...options(root, true), allowAsk: false });
    assert.ok(!prompt.includes(MAIN_CAPABILITY_GUIDANCE.ask));
    assertOnce(prompt, MAIN_TEAM);
    for (const id of ['background', 'board', 'memory'] as const) {
      assertOnce(prompt, MAIN_CAPABILITY_GUIDANCE[id]);
    }
  });
});
