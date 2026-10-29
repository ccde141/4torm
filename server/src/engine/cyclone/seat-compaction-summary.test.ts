import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeatCompactionPrompt } from './seat-compaction-summary.js';

test('气旋滚动摘要要求保留继续工作所需的结构化事实', () => {
  const prompt = buildSeatCompactionPrompt(
    '工位「开发」私聊',
    '用户: 修复构建\n工具调用 run_command: npm test\n工具结果: 12 tests passed',
  );
  for (const section of ['目标与背景', '约束与偏好', '进度', '关键决定', '下一步', '重要资料']) assert.ok(prompt.includes(section));
  assert.match(prompt, /区分计划、已执行与已验证/);
  assert.match(prompt, /证据位置/);
  assert.match(prompt, /任务、工位、运行和回执 ID/);
  assert.match(prompt, /受理、排队或执行中不等于完成/);
  assert.match(prompt, /工具调用 run_command/);
  assert.match(prompt, /以全部输入为依据/);
});
