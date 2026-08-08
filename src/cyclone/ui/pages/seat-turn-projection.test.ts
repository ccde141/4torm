import assert from 'node:assert/strict';
import test from 'node:test';
import type { DisplayMessage } from './messageDisplay.js';
import {
  createLiveSeatTurn,
  projectSeatTimeline,
} from './seat-turn-projection.js';

function assistant(id: string, sourceIndex: number, content = '', tool?: string): DisplayMessage {
  return {
    id, sourceIndex, role: 'assistant', content,
    ...(tool ? { blocks: [{ kind: 'tool', tool, args: {}, status: 'success' as const }] } : {}),
  };
}

test('连续 Assistant 原生记录合并为一个有序工作回合', () => {
  const timeline = projectSeatTimeline([
    { id: 'u1', sourceIndex: 0, role: 'user', content: '开始' },
    assistant('a1', 1, '先检查'),
    assistant('a2', 2, '', 'read_file'),
    assistant('a3', 4, '已经找到问题'),
    assistant('a4', 5, '', 'write_file'),
    assistant('a5', 7, '修复完成'),
  ]);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[1].kind, 'turn');
  if (timeline[1].kind !== 'turn') return;
  assert.deepEqual(timeline[1].turn.workSegments.map(segment => ({
    content: segment.content,
    tools: segment.blocks.map(block => block.kind === 'tool' ? block.tool : block.kind),
  })), [
    { content: '先检查', tools: [] },
    { content: '', tools: ['read_file'] },
    { content: '已经找到问题', tools: [] },
    { content: '', tools: ['write_file'] },
  ]);
  assert.equal(timeline[1].turn.finalContent, '修复完成');
  assert.equal(timeline[1].turn.actionMessage?.sourceIndex, 7);
});

test('用户和可见系统记录是回合硬边界', () => {
  const timeline = projectSeatTimeline([
    assistant('a1', 0, '第一轮'),
    { id: 's1', sourceIndex: 1, role: 'system', content: '归档摘要' },
    assistant('a2', 2, '第二轮'),
    { id: 'u1', sourceIndex: 3, role: 'user', content: '继续' },
    assistant('a3', 4, '第三轮'),
  ]);

  assert.deepEqual(timeline.map(item => item.kind), ['turn', 'message', 'turn', 'message', 'turn']);
});

test('仅有工具的内部记录没有顶层编辑删除归属', () => {
  const timeline = projectSeatTimeline([assistant('a1', 3, '', 'run_command')]);

  assert.equal(timeline[0].kind, 'turn');
  if (timeline[0].kind !== 'turn') return;
  assert.equal(timeline[0].turn.finalContent, '');
  assert.equal(timeline[0].turn.actionMessage, undefined);
});

test('实时片段使用与历史相同的工作过程和最终回答规则', () => {
  const turn = createLiveSeatTurn([
    { content: '准备读取', blocks: [{ kind: 'tool', tool: 'read_file', args: {}, status: 'success' }] },
    { content: '读取完成', blocks: [] },
  ], '分析路径');

  assert.equal(turn.reasoning, '分析路径');
  assert.deepEqual(turn.workSegments.map(segment => segment.content), ['准备读取', '']);
  assert.equal(turn.finalContent, '读取完成');
  assert.equal(turn.actionMessage, undefined);
});

test('末尾 Ask 留在工作回合内且不会伪造最终回答', () => {
  const timeline = projectSeatTimeline([{
    id: 'ask', sourceIndex: 2, role: 'assistant', content: '',
    blocks: [{ kind: 'ask', question: '继续吗？', answered: false }],
  }]);

  assert.equal(timeline[0].kind, 'turn');
  if (timeline[0].kind !== 'turn') return;
  assert.equal(timeline[0].turn.finalContent, '');
  assert.equal(timeline[0].turn.workSegments[0].blocks[0].kind, 'ask');
});
