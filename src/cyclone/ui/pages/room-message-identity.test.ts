import assert from 'node:assert/strict';
import test from 'node:test';
import { findRoomMessageIndex, snapshotRoomMessage } from './room-message-identity.js';

const original = { id: 'message-a', timestamp: 12, speaker: '人类', content: '原文' };

test('编辑中的消息按原始身份跟随位置变化，不会跳到下一条', () => {
  const expected = snapshotRoomMessage(original);
  assert.deepEqual(expected, original);
  assert.equal(findRoomMessageIndex([
    { id: 'message-b', timestamp: 13, speaker: '工位', content: '后文' }, original,
  ], expected), 1);
  assert.equal(findRoomMessageIndex([
    { id: 'message-b', timestamp: 13, speaker: '工位', content: '后文' },
  ], expected), -1);
  assert.equal(findRoomMessageIndex([
    { ...original, content: '别处已改' },
  ], expected), -1);
});

test('历史无 ID 的消息只在联合身份唯一且正文未变时可定位', () => {
  const legacy = { timestamp: 42, speaker: '工位', content: '旧消息' };
  const expected = snapshotRoomMessage(legacy);
  assert.equal(findRoomMessageIndex([legacy], expected), 0);
  assert.equal(findRoomMessageIndex([legacy, legacy], expected), -1);
});
