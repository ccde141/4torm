import assert from 'node:assert/strict';
import test from 'node:test';
import { roomSeatName } from './room-seat-name';

test('已删除工位从会议历史恢复实际名称', () => {
  assert.equal(roomSeatName('seat-old', [], [{
    speaker: '系统', content: '研究员加入会议', kind: 'membership',
    membershipAction: 'joined', seatId: 'seat-old', timestamp: 1,
  }]), '研究员');
});

test('优先使用仍存在工位的当前名称', () => {
  assert.equal(roomSeatName('seat-live', [{ id: 'seat-live', title: '新名称' }], [{
    speaker: '旧名称', content: '历史消息', seatId: 'seat-live', timestamp: 1,
  }]), '新名称');
});
