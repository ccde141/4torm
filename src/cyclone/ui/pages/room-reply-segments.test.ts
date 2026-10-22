import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendRoomDispatch,
  appendRoomText,
  appendRoomTool,
  completeRoomTool,
  reconcileRoomAnswer,
  type RoomReplySegment,
} from './room-reply-segments.js';

test('群聊分段保留正文、工具与派发的真实交错顺序', () => {
  const segments: RoomReplySegment[] = [];
  appendRoomText(segments, '第一段');
  appendRoomTool(segments, 'read_file', { path: 'a.txt' });
  completeRoomTool(segments, 'done', true);
  appendRoomText(segments, '第二段');
  appendRoomDispatch(segments, 'dispatch-a');
  reconcileRoomAnswer(segments, '第一段\n\n第二段\n\n最终段');

  assert.deepEqual(segments.map(segment => segment.kind), [
    'text', 'tools', 'text', 'dispatch', 'text',
  ]);
});

test('群聊联络已受理但未完成时保持处理中，忙线不显示成功', () => {
  for (const state of ['running', 'busy']) {
    const segments: RoomReplySegment[] = [];
    appendRoomTool(segments, 'contact', { target: '主管' });
    completeRoomTool(segments, JSON.stringify({ contactId: 'c', status: state, delivered: state === 'running' }), state === 'running');
    const segment = segments[0];
    assert.equal(segment.kind === 'tools' ? segment.tools[0].status : null, state === 'running' ? 'running' : 'error');
  }
});
