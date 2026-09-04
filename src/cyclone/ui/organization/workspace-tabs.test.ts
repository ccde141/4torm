import assert from 'node:assert/strict';
import test from 'node:test';
import { closeWorkspaceTab, openWorkspaceTab, tabKey } from './workspace-tabs';

const seatA = { kind: 'seat' as const, id: 'a', title: 'A' };
const roomB = { kind: 'room' as const, id: 'b', title: 'B' };

test('重复打开同一工位只更新标题，不创建重复标签', () => {
  assert.deepEqual(openWorkspaceTab([seatA], { ...seatA, title: 'A2' }), [{ ...seatA, title: 'A2' }]);
});

test('关闭活动标签回落到相邻标签，不删除会话数据', () => {
  const result = closeWorkspaceTab([seatA, roomB], tabKey(roomB), tabKey(roomB));
  assert.deepEqual(result.tabs, [seatA]);
  assert.equal(result.activeKey, tabKey(seatA));
});

test('关闭最后一个观察标签回到固定关系图', () => {
  assert.equal(closeWorkspaceTab([seatA], tabKey(seatA), tabKey(seatA)).activeKey, null);
});
