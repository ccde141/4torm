import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomMessage } from './types.js';
import { planRoomCompaction } from './room-compaction.js';

function message(speaker: string, content: string, roundSeq: number): RoomMessage {
  return { speaker, content, roundSeq, timestamp: roundSeq };
}

test('群聊压缩按完整人类轮次归档并保留最近三轮', () => {
  const messages = [
    message('人类', '第一轮', 1), message('架构', '答一', 1),
    message('人类', '第二轮', 2), message('架构', '答二', 2),
    message('人类', '第三轮', 3), message('架构', '答三', 3),
    message('人类', '第四轮', 4), message('架构', '答四', 4),
  ];
  const plan = planRoomCompaction(messages, 10_000, 10_000);

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.archivedMessages, messages.slice(0, 2));
  assert.deepEqual(plan.keptMessages, messages.slice(2));
  assert.equal(plan.keptRoundCount, 3);
});

test('群聊 reasoning 不进入压缩摘要输入', () => {
  const messages = [
    { ...message('人类', '第一轮', 1), reasoning: '不应进入摘要的隐私推理' },
    message('架构', '公开结论', 1),
    message('人类', '第二轮', 2), message('架构', '答二', 2),
    message('人类', '第三轮', 3), message('架构', '答三', 3),
    message('人类', '第四轮', 4), message('架构', '答四', 4),
  ];
  const plan = planRoomCompaction(messages, 10_000, 10_000);

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.match(plan.summaryInput, /公开结论/);
  assert.doesNotMatch(plan.summaryInput, /隐私推理/);
});

test('未达到已探测安全预算时不压缩', () => {
  const messages = [
    message('人类', '一', 1), message('工位', '答', 1),
    message('人类', '二', 2), message('人类', '三', 3), message('人类', '四', 4),
  ];
  const plan = planRoomCompaction(messages, 9_999, 10_000);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.reason, 'below-budget');
});

test('旧群聊缺少 tokenUsage 时只估算公开上下文且仍可提前压缩', () => {
  const large = '公开内容'.repeat(200);
  const messages = [1, 2, 3, 4].flatMap(round => ([
    { ...message('人类', `${round}${large}`, round), reasoning: 'x'.repeat(50_000) },
    message('工位', large, round),
  ]));
  const plan = planRoomCompaction(messages, undefined, 1_000);
  assert.equal(plan.ok, true);
});
