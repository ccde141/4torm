/**
 * EnvelopeDraft 单元测试 —— 直接用 tsx 跑（本仓库暂无 vitest runner）：
 *   cd server && npx tsx src/engine/tradewind/execution/envelope-draft.test.ts
 * 断言失败即抛错、进程非零退出；全绿打印 ok。
 */

import assert from 'node:assert/strict';
import { EnvelopeDraft, execEnvelopeTool, ENVELOPE_TOOL_NAMES, COMPLETE_TASK_TOOL, isEnvelopeRound, classifyRoundInterrupt } from './envelope-draft';
import { buildEnvelopeToolDefs } from './virtual-tools';

function run(name: string, fn: () => void) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('EnvelopeDraft');

run('增：add 返回自增 id 且进入 list', () => {
  const d = new EnvelopeDraft();
  const a = d.add('买入信号确认');
  const b = d.add('目标价 42.5');
  assert.deepEqual(a, { id: 'e1', text: '买入信号确认' });
  assert.deepEqual(b, { id: 'e2', text: '目标价 42.5' });
  assert.equal(d.list().length, 2);
});

run('增：空白文本返回 null 不入列', () => {
  const d = new EnvelopeDraft();
  assert.equal(d.add('   '), null);
  assert.equal(d.add(''), null);
  assert.equal(d.list().length, 0);
});

run('增：文本裁到 4000 上限', () => {
  const d = new EnvelopeDraft();
  const e = d.add('x'.repeat(5000))!;
  assert.equal(e.text.length, 4000);
});

run('删：按 id 删除；未知 id 返回 false', () => {
  const d = new EnvelopeDraft();
  d.add('一'); d.add('二');
  assert.equal(d.remove('e1'), true);
  assert.equal(d.remove('e1'), false);
  assert.equal(d.remove('nope'), false);
  assert.deepEqual(d.list().map(e => e.text), ['二']);
});

run('删后再增：id 计数器不回退（不复用 e1）', () => {
  const d = new EnvelopeDraft();
  d.add('一'); d.remove('e1');
  const c = d.add('三')!;
  assert.equal(c.id, 'e2');
});

run('扫：list 是只读快照，改它不影响内部', () => {
  const d = new EnvelopeDraft();
  d.add('一');
  const snap = d.list() as DraftEntryMut[];
  snap.push({ id: 'x', text: 'hack' });
  assert.equal(d.list().length, 1);
});

run('封口：条目 + 备注两段齐全', () => {
  const d = new EnvelopeDraft();
  d.add('决策为买入'); d.add('仓位 30%');
  const sealed = d.seal('风控那边我已经打过招呼了，放心接');
  assert.match(sealed, /## 交接信息/);
  assert.match(sealed, /1\. 决策为买入/);
  assert.match(sealed, /2\. 仓位 30%/);
  assert.match(sealed, /## 交接备注/);
  assert.match(sealed, /风控那边/);
});

run('封口：纯备注（无条目）', () => {
  const d = new EnvelopeDraft();
  const sealed = d.seal('没啥硬结论，口头交接一下');
  assert.doesNotMatch(sealed, /## 交接信息/);
  assert.match(sealed, /## 交接备注/);
});

run('封口：纯条目（无备注）', () => {
  const d = new EnvelopeDraft();
  d.add('唯一结论');
  const sealed = d.seal();
  assert.match(sealed, /## 交接信息/);
  assert.doesNotMatch(sealed, /## 交接备注/);
});

run('封口：空草稿 + 空备注给明确空标记', () => {
  const d = new EnvelopeDraft();
  assert.match(d.seal(), /未留下结构化条目或备注/);
  assert.equal(d.isEmpty(), true);
});

console.log('execEnvelopeTool + 工具定义');

run('execEnvelopeTool：add 改草稿并回填全貌', () => {
  const d = new EnvelopeDraft();
  const r = execEnvelopeTool(d, 'envelope_add', { text: '结论A' });
  assert.match(r, /已添加条目 \[e1\]/);
  assert.match(r, /\[e1\] 结论A/);
  assert.equal(d.list().length, 1);
});

run('execEnvelopeTool：add 空 text 给失败反馈，不入列', () => {
  const d = new EnvelopeDraft();
  const r = execEnvelopeTool(d, 'envelope_add', { text: '  ' });
  assert.match(r, /envelope_add 失败/);
  assert.equal(d.isEmpty(), true);
});

run('execEnvelopeTool：remove 命中 / 未命中', () => {
  const d = new EnvelopeDraft();
  execEnvelopeTool(d, 'envelope_add', { text: 'x' });
  assert.match(execEnvelopeTool(d, 'envelope_remove', { id: 'e1' }), /已删除 \[e1\]/);
  assert.match(execEnvelopeTool(d, 'envelope_remove', { id: 'e1' }), /未找到条目 e1/);
});

run('execEnvelopeTool：list 回填当前信封', () => {
  const d = new EnvelopeDraft();
  execEnvelopeTool(d, 'envelope_add', { text: '甲' });
  assert.match(execEnvelopeTool(d, 'envelope_list', {}), /\[e1\] 甲/);
});

run('execEnvelopeTool：complete_task 返回封口内容（条目+备注）', () => {
  const d = new EnvelopeDraft();
  execEnvelopeTool(d, 'envelope_add', { text: '决策买入' });
  const sealed = execEnvelopeTool(d, COMPLETE_TASK_TOOL, { note: '风控已知会' });
  assert.match(sealed, /## 交接信息/);
  assert.match(sealed, /1\. 决策买入/);
  assert.match(sealed, /## 交接备注/);
  assert.match(sealed, /风控已知会/);
});

run('execEnvelopeTool：未知工具给明确提示', () => {
  const d = new EnvelopeDraft();
  assert.match(execEnvelopeTool(d, 'envelope_wat', {}), /未知信封工具/);
});

run('buildEnvelopeToolDefs：恰好四个工具、名字与 ENVELOPE_TOOL_NAMES 对齐', () => {
  const defs = buildEnvelopeToolDefs();
  const names = defs.map(d => d.name);
  assert.deepEqual(names, [...ENVELOPE_TOOL_NAMES]);
  assert.equal(names.length, 4);
  // complete_task 的 note 可选（无 required）；add/remove 各有必填
  const complete = defs.find(d => d.name === COMPLETE_TASK_TOOL)!;
  assert.equal((complete.parameters as any).required, undefined);
  const add = defs.find(d => d.name === 'envelope_add')!;
  assert.deepEqual((add.parameters as any).required, ['text']);
});

run('isEnvelopeRound：仅 native envelope 轮为真', () => {
  assert.equal(isEnvelopeRound('envelope', true), true);
});

run('isEnvelopeRound：human/contact 轮永远为假（即便 native）', () => {
  assert.equal(isEnvelopeRound('human', true), false);
  assert.equal(isEnvelopeRound('contact', true), false);
});

run('isEnvelopeRound：text 循环 envelope 轮也为假（零回归）', () => {
  assert.equal(isEnvelopeRound('envelope', false), false);
  assert.equal(isEnvelopeRound('envelope', undefined), false);
});

run('classifyRoundInterrupt：pause() 触发 + 承载信封 → pause（绝不投递）', () => {
  assert.equal(classifyRoundInterrupt(true, true, true), 'pause');
});

run('classifyRoundInterrupt：全局停止（abort 但非 pausing）+ 信封 → deliver 兜底', () => {
  assert.equal(classifyRoundInterrupt(true, false, true), 'deliver');
});

run('classifyRoundInterrupt：真错误 + 信封 → deliver 兜底（不悬挂下游）', () => {
  assert.equal(classifyRoundInterrupt(false, false, true), 'deliver');
});

run('classifyRoundInterrupt：pausing 但不承载信封（human 轮）→ silent', () => {
  assert.equal(classifyRoundInterrupt(true, true, false), 'silent');
  assert.equal(classifyRoundInterrupt(true, false, false), 'silent');
});

console.log('ok');

// 仅为上面的只读快照断言提供一个可变类型别名
interface DraftEntryMut { id: string; text: string; }
