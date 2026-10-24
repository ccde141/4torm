import assert from 'node:assert/strict';
import test from 'node:test';
import { splitTurnSegments } from './cyclone-room-turn.js';
import fs from 'node:fs';

test('气旋群聊将最终正文与按序工作过程归属到同一 Agent 回合', () => {
  const parts = splitTurnSegments({
    content: '准备检查\n最终结论',
    tools: [],
    segments: [
      { kind: 'text', content: '准备检查' },
      { kind: 'tools', tools: [{ tool: 'read_file', args: { path: 'a' }, result: 'ok', status: 'success' }] },
      { kind: 'text', content: '继续核验' },
      { kind: 'dispatch', dispatchId: 'dispatch-a' },
      { kind: 'text', content: '最终结论' },
    ],
  });

  assert.equal(parts.finalContent, '最终结论');
  assert.deepEqual(parts.workSegments.map(segment => segment.kind), ['text', 'tools', 'text', 'dispatch']);
});

test('旧群聊记录没有 segments 时仍把工具归入工作过程', () => {
  const parts = splitTurnSegments({
    content: '历史结论',
    tools: [{ tool: 'run_command', args: { command: 'npm test' }, result: 'ok', status: 'success' }],
  });

  assert.equal(parts.finalContent, '历史结论');
  assert.deepEqual(parts.workSegments.map(segment => segment.kind), ['tools']);
});

test('末尾是派发时不把更早正文跨过派发重新排序', () => {
  const parts = splitTurnSegments({
    content: '请目标工位继续核验',
    tools: [],
    segments: [
      { kind: 'text', content: '请目标工位继续核验' },
      { kind: 'dispatch', dispatchId: 'dispatch-a' },
    ],
  });

  assert.equal(parts.finalContent, '请目标工位继续核验');
  assert.deepEqual(parts.workSegments.map(segment => segment.kind), ['text', 'dispatch']);
});

test('普通工具分组仍允许用户收起失败条目', () => {
  const toolActivity = fs.readFileSync('src/cyclone/ui/pages/CycloneToolActivityList.tsx', 'utf8');

  assert.doesNotMatch(toolActivity, /open=\{failed > 0\}/);
  assert.match(toolActivity, /onToggle=/);
});
