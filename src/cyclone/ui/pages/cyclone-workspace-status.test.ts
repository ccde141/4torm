import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWorkspaceStatus } from './cyclone-workspace-status';
import type { CycloneDispatch } from './dispatch-timeline';

function dispatch(status: CycloneDispatch['status'], readState: CycloneDispatch['readState'] = 'unread'): CycloneDispatch {
  return { id: status, workshopId: 'w', sourceKind: 'room', sourceRoomId: 'r', sourceSeatId: 'a',
    sourceSeatTitle: 'A', sourceTurnId: 't', sourceRoundSeq: 1, dispatchOrder: 0,
    targetSeatId: 'b', targetSeatTitle: 'B', task: 'task', status, readState,
    decisionState: 'pending', createdAt: '', updatedAt: '' };
}

test('工位、群聊与会议助理共享同一状态优先级', () => {
  const status = projectWorkspaceStatus({
    seats: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', pending: true }],
    rooms: [{ id: 'r', title: 'R' }], dispatches: [dispatch('failed')],
    getSeatRunner: id => id === 'chair:r' ? { streaming: true, outcome: 'running' } : undefined,
    getRoomRunner: () => undefined, chairKey: id => `chair:${id}`,
  });
  assert.equal(status.seats.get('b'), 'waiting');
  assert.equal(status.rooms.get('r'), 'running');
});

test('失败与未读完成分开呈现，已读结果回到空闲', () => {
  const base = { seats: [{ id: 'b', title: 'B' }], rooms: [], getSeatRunner: () => undefined,
    getRoomRunner: () => undefined, chairKey: (id: string) => id };
  assert.equal(projectWorkspaceStatus({ ...base, dispatches: [dispatch('failed')] }).seats.get('b'), 'failed');
  assert.equal(projectWorkspaceStatus({ ...base, dispatches: [dispatch('completed')] }).seats.get('b'), 'unread');
  assert.equal(projectWorkspaceStatus({ ...base, dispatches: [dispatch('completed', 'read')] }).seats.get('b'), 'idle');
});
