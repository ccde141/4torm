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
