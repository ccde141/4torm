/**
 * 信封交接 system prompt 段单测 —— 用 tsx 跑：
 *   cd server && npx tsx src/engine/tradewind/execution/prompt-builder.auto.test.ts
 *
 * 验证信封交接段：对所有 native agent（含手动）注入「complete_task 显式交接」语义 + 信封工具，
 * autoMode 只调开头措辞；text agent（native=false）保留「<answer> 即交付」，绝不出现 complete_task。
 */

import assert from 'node:assert/strict';
import { buildTradewindSystemPrompt, type TradewindPromptParams } from './prompt-builder';

const base: TradewindPromptParams = {
  rolePrompt: '你是测试 Agent。',
  toolDefs: [],
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

run('text agent（native=false）→ 无交接信封段、无 complete_task，保留 <answer> 措辞', () => {
  const p = buildTradewindSystemPrompt({ ...base, native: false });
  assert.doesNotMatch(p, /# 交接信封/);
  assert.doesNotMatch(p, /complete_task/);
  assert.match(p, /完成后输出 <answer>/);
});

console.log('ok');
