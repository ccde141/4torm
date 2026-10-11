import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeatCompactionPrompt } from './seat-compaction-summary.js';

test('气旋滚动摘要要求保留继续工作所需的结构化事实', () => {
  const prompt = buildSeatCompactionPrompt(
    '工位「开发」私聊',
    '用户: 修复构建\n工具调用 run_command: npm test\n工具结果: 12 tests passed',
  );
  assert.match(prompt, /已验证事实与证据/);
  assert.match(prompt, /任务、运行、会话、工位与记录 ID/);
  assert.match(prompt, /受理或排队不能写成完成/);
  assert.match(prompt, /工具调用 run_command/);
  assert.match(prompt, /只总结输入中确有依据/);
});
