import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomMessageSegments } from './room-message-segments.js';

test('群聊落盘分段保留正文、工具与派发的真实交错顺序', () => {
  const collector = createRoomMessageSegments();
  collector.token('第一段');
  collector.toolCall('read_file', { path: 'a.txt' });
  collector.toolResult('done', true);
  collector.token('第二段');
  collector.dispatch('dispatch-a');
  collector.reconcile('第一段\n\n第二段\n\n最终段');

  assert.deepEqual(collector.segments.map(segment => segment.kind), [
    'text', 'tools', 'text', 'dispatch', 'text',
  ]);
  assert.deepEqual(collector.segments.at(-1), { kind: 'text', content: '最终段' });
});
