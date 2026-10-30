import assert from 'node:assert/strict';
import test from 'node:test';
import { meetingContextMessages, meetingContextBoundaries, replaceMeetingPrefix }
  from './meeting-compaction-context.js';

test('meeting compression carries speaker and actual tool results into the summary source', () => {
  const messages = meetingContextMessages([{ speaker: '审计员', content: '已检查', timestamp: 1,
    toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' }, result: '真实证据' }] }]);
  assert.match(messages[0].content, /审计员/);
  assert.match(messages[0].content, /真实证据/);
  assert.match(messages[0].content, /a.ts/);
});

test('an empty compacted meeting projection does not restore display text or tool output', () => {
  const messages = meetingContextMessages([{ speaker: '审计员', content: '旧展示', modelContent: '', timestamp: 1,
    toolCalls: [{ tool: 'read_file', args: {}, result: '已压缩证据' }] }]);
  assert.doesNotMatch(messages[0].content, /旧展示|已压缩证据/);
});

test('meeting prefix replacement retains the current round and its exact timestamps', () => {
  const old = [{ speaker: '人类', content: '旧议题', timestamp: 1 },
    { speaker: 'A', content: '旧回复', timestamp: 2 },
    { speaker: '人类', content: '正在讨论', timestamp: 3 },
    { speaker: 'A', content: '正在回答', timestamp: 4, streaming: true }];
  assert.deepEqual(meetingContextBoundaries(old), [1, 2, 3, 4]);
  const next = replaceMeetingPrefix(old, 2, '先前共识', 10);
  assert.match(next[0].content, /先前共识/);
  assert.deepEqual(next.slice(1), old.slice(2));
  assert.equal(old.length, 4);
});

test('meeting compaction may split completed replies for budget retention but never a streaming reply', () => {
  const messages = [{ speaker: '人类', content: '议题', timestamp: 1 },
    { speaker: 'A', content: '回复', timestamp: 2 }];
  assert.deepEqual(replaceMeetingPrefix(messages, 1, '摘要').slice(1), messages.slice(1));
  assert.throws(() => replaceMeetingPrefix([{ ...messages[0], streaming: true }, messages[1]], 1, '摘要'), /未完成发言/);
});

test('meeting prefix replacement keeps selected human directions while dropping their compressed execution records', () => {
  const records = [{ speaker: '人类', content: '原始约束', timestamp: 1 },
    { speaker: 'A', content: '旧执行', timestamp: 2,
      toolCalls: [{ tool: 'read_file', args: {}, result: '已压缩证据' }] },
    { speaker: 'B', content: '最新进度', timestamp: 3 }];
  const result = replaceMeetingPrefix(records, 2, '此前证据已核验', 10, [0, 2]);
  assert.deepEqual(result.slice(1), [records[0], records[2]]);
  assert.equal(result[1], records[0]);
  assert.doesNotMatch(JSON.stringify(result), /已压缩证据|旧执行/);
  assert.throws(() => replaceMeetingPrefix(records, 2, '摘要', 10, [2, 0]), /保留计划无效/);
});
