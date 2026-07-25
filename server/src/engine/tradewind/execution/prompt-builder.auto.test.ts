/**
 * 信封交接 system prompt 段单测 —— 用 tsx 跑：
 *   cd server && npx tsx src/engine/tradewind/execution/prompt-builder.auto.test.ts
 *
 * 验证信封交接段：对所有 native agent（含手动）注入「complete_task 显式交接」语义 + 信封工具，
 * autoMode 只调开头措辞；text agent（native=false）使用 JSON 工具信封，普通文本直接交付。
 */

import assert from 'node:assert/strict';
import { buildTradewindSystemPrompt, type TradewindPromptParams } from './prompt-builder';

const base: TradewindPromptParams = {
  rolePrompt: '你是测试 Agent。',
  toolDefs: [{
    name: 'read_file',
    description: '读取文件',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string', description: '文件路径' } },
      required: ['filePath'],
    },
  }],
  notes: [],
  nodeLabel: '甲节点',
  teamRoster: [{ label: '甲节点', role: 'x', isSelf: true }],
  workspace: 'data/x/workspace',
  workspaceAbs: '/abs/x/workspace',
  projectDir: '/abs',
  sandboxLevel: 'relaxed',
  allowDelegate: true,
  agentName: '测试员',
  executionId: 'exec1',
  nodeId: 'n1',
  workflowId: 'wf1',
  platform: 'linux',
  today: '2026-07-06',
  modelId: 'claude-x',
  native: true,
};

function run(name: string, fn: () => void) { fn(); console.log(`  ✓ ${name}`); }

console.log('信封交接 prompt 段');

run('native + autoMode=true → 含交接信封段（自动措辞）+ complete_task + 信封工具', () => {
  const p = buildTradewindSystemPrompt({ ...base, native: true, autoMode: true });
  assert.match(p, /平等的协作者/);
  assert.match(p, /信封是当前节点的任务契约/);
  assert.match(p, /不替上下游包办/);
  assert.match(p, /委托不转移.*交付责任/);
  assert.match(p, /# 交接信封/);
  assert.match(p, /自动模式/);
  assert.match(p, /complete_task/);
  assert.match(p, /envelope_add/);
  assert.match(p, /必须调用 complete_task 封口交接/);
});

run('native + 手动（autoMode 缺省）→ 也含交接信封段 + complete_task（手动措辞）', () => {
  const p = buildTradewindSystemPrompt({ ...base, native: true });
  assert.match(p, /# 交接信封/);
  assert.match(p, /complete_task/);
  assert.match(p, /必须调用 complete_task 封口交接/);
  // 手动措辞：点明人类聊天不触发交接
  assert.match(p, /那只是聊天，不触发交接|人类可随时与你对话/);
  // 不应出现"自动模式：没有人类实时驱动"这种自动专属开头
  assert.doesNotMatch(p, /没有人类实时驱动/);
});

run('text agent（native=false）→ JSON 工具信封，普通自然语言自动交接', () => {
  const p = buildTradewindSystemPrompt({ ...base, native: false });
  assert.doesNotMatch(p, /# 交接信封/);
  assert.doesNotMatch(p, /complete_task/);
  assert.match(p, /"type":"tool_call"/);
  assert.match(p, /完成后直接输出自然语言，会自动打包成信封交给下游/);
  assert.doesNotMatch(p, /<action|<answer|<think|<result/);
});

console.log('ok');
