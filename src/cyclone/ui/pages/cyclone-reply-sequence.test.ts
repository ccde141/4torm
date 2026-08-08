import assert from 'node:assert/strict';
import test from 'node:test';
import type { DisplayBlock, DisplayMessage } from './messageDisplay.js';
import {
  appendReplyBlock,
  appendReplyText,
  buildSeatDisplayHistory,
  reconcileReplyAnswer,
  type CycloneReplySegment,
} from './cyclone-reply-sequence.js';

function tool(tool: string): DisplayBlock {
  return { kind: 'tool', tool, args: {}, status: 'success' };
}

function describe(segments: CycloneReplySegment[]) {
  return segments.flatMap(segment => [
    ...(segment.content ? [`text:${segment.content}`] : []),
    ...segment.blocks.map(block => `block:${block.kind === 'tool' ? block.tool : block.kind}`),
  ]);
}

test('复杂穿插按正文与工具的真实边界形成展示序列', () => {
  const segments: CycloneReplySegment[] = [];
  appendReplyText(segments, '第一波');
  appendReplyBlock(segments, tool('read_file'));
  appendReplyBlock(segments, tool('write_file'));
  appendReplyText(segments, '第二波');
  appendReplyBlock(segments, { kind: 'delegate', id: 'd1', task: 'test', steps: [], status: 'success' });
  appendReplyBlock(segments, { kind: 'contact', id: 'c1', target: '信息搜集者', message: 'test', status: 'success' });
  appendReplyText(segments, '第三波');
  appendReplyBlock(segments, tool('dispatch'));
  appendReplyText(segments, '最后一波');
  appendReplyBlock(segments, { kind: 'ask', question: '继续吗？', answered: false });

  assert.deepEqual(describe(segments), [
    'text:第一波', 'block:read_file', 'block:write_file',
    'text:第二波', 'block:delegate', 'block:contact',
    'text:第三波', 'block:dispatch',
    'text:最后一波', 'block:ask',
  ]);
});

test('最终 answer 只补充尚未流式出现的尾段', () => {
  const segments: CycloneReplySegment[] = [];
  appendReplyText(segments, '第一波');
  appendReplyBlock(segments, tool('read_file'));
  appendReplyText(segments, '第二波');

  reconcileReplyAnswer(segments, '第一波\n\n第二波\n\n最终总结');

  assert.deepEqual(describe(segments), [
    'text:第一波', 'block:read_file', 'text:第二波', 'text:最终总结',
  ]);
});

test('Ask 乐观回复替换原挂起卡，而不是追加重复卡', () => {
  const history: DisplayMessage[] = [{
    id: 'ask-old', role: 'assistant', content: '',
    blocks: [{ kind: 'ask', question: '继续吗？', answered: false }],
  }];
  const optimistic: DisplayMessage = {
    id: 'ask-new', role: 'assistant', content: '',
    blocks: [{ kind: 'ask', question: '继续吗？', answered: true, reply: '继续' }],
  };

  const visible = buildSeatDisplayHistory(history, optimistic);

  assert.equal(visible.length, 1);
  assert.deepEqual(visible[0].blocks, optimistic.blocks);
});

test('Ask 乐观回复即使短暂存在于历史和 runner 两处也只显示一次', () => {
  const pending: DisplayMessage = {
    id: 'ask-old', role: 'assistant', content: '',
    blocks: [{ kind: 'ask', question: '选择发布方式', answered: false }],
  };
  const optimistic: DisplayMessage = {
    id: 'ask-new', role: 'assistant', content: '',
    blocks: [{ kind: 'ask', question: '选择发布方式', answered: true, reply: '稳定发布' }],
  };

  const visible = buildSeatDisplayHistory([pending, optimistic], optimistic);

  assert.equal(visible.length, 1);
  assert.deepEqual(visible[0].blocks, optimistic.blocks);
});

test('Ask 已回答历史与 resume runner 重叠时仍只显示一张卡', () => {
  const persisted: DisplayMessage = {
    id: 'ask-persisted', role: 'assistant', content: '',
    blocks: [{ kind: 'ask', question: '选择发布方式', answered: true, reply: '稳定发布' }],
  };
  const optimistic: DisplayMessage = {
    id: 'ask-optimistic', role: 'assistant', content: '',
    blocks: [{ kind: 'ask', question: '选择发布方式', answered: true, reply: '稳定发布' }],
  };

  const visible = buildSeatDisplayHistory([persisted], optimistic);

  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, persisted.id);
  assert.deepEqual(visible[0].blocks, optimistic.blocks);
});
