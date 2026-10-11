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

test('external room execution is projected from the exact room identity', () => {
  const base = { seats: [], rooms: [{ id: 'r', title: 'R' }], dispatches: [],
    getSeatRunner: () => undefined, getRoomRunner: () => undefined,
    chairKey: (id: string) => `chair:${id}` };
  assert.equal(projectWorkspaceStatus({ ...base,
    externalRoom: { roomId: 'r', running: true } }).rooms.get('r'), 'running');
  assert.equal(projectWorkspaceStatus({ ...base,
    externalRoom: { roomId: 'r', running: false, status: 'crashed' } }).rooms.get('r'), 'failed');
  assert.equal(projectWorkspaceStatus({ ...base,
    externalRoom: { roomId: 'other', running: true } }).rooms.get('r'), 'idle');
});

test('未打开的工位私聊、房间轮次和会长私聊沿用中心运行事实', () => {
  const operations = {
    seats: new Map([['a', { operationId: 'seat:w:a', title: 'A', phase: 'seat-chat',
      status: 'running' as const }]]),
    rooms: new Map([
      ['r', { operationId: 'room:w:r', title: 'R', phase: 'room-speak', status: 'failed' as const }],
      ['c', { operationId: 'room:w:c', title: 'C', phase: 'chair-chat', status: 'running' as const }],
    ]),
  };
  const projected = projectWorkspaceStatus({
    seats: [{ id: 'a', title: 'A' }], rooms: [{ id: 'r', title: 'R' }, { id: 'c', title: 'C' }],
    dispatches: [], getSeatRunner: () => undefined, getRoomRunner: () => undefined,
    chairKey: id => `chair:${id}`, operations,
  });
  assert.equal(projected.seats.get('a'), 'running');
  assert.equal(projected.rooms.get('r'), 'failed');
  assert.equal(projected.rooms.get('c'), 'running');
});

test('新运行事实覆盖同实体遗留失败，活跃派发与运行状态按统一优先级显示', () => {
  const base = { seats: [{ id: 'b', title: 'B' }], rooms: [], chairKey: (id: string) => `chair:${id}`,
    getRoomRunner: () => undefined };
  const completed = { operationId: 'seat:w:b', title: 'B', phase: 'seat-chat',
    status: 'completed' as const, runId: 'new' };
  assert.equal(projectWorkspaceStatus({ ...base, dispatches: [],
    getSeatRunner: () => ({ streaming: false, outcome: 'failed', runId: 'old' }),
    operations: { seats: new Map([['b', completed]]), rooms: new Map() },
  }).seats.get('b'), 'idle');
  assert.equal(projectWorkspaceStatus({ ...base, dispatches: [],
    getSeatRunner: () => ({ streaming: false, outcome: 'failed', runId: 'new' }),
    operations: { seats: new Map([['b', completed]]), rooms: new Map() },
  }).seats.get('b'), 'idle');
  assert.equal(projectWorkspaceStatus({ ...base, dispatches: [dispatch('running')],
    getSeatRunner: () => ({ streaming: false, outcome: 'failed' }),
  }).seats.get('b'), 'running');
  assert.equal(projectWorkspaceStatus({ ...base, dispatches: [],
    getSeatRunner: () => ({ streaming: true, runId: 'new' }),
    operations: { seats: new Map([['b', { ...completed, status: 'failed' as const,
      runId: 'old' }]]), rooms: new Map() },
  }).seats.get('b'), 'running');
});

test('中心探针断线后，原先活跃的实体显示待核实而非一直运行', () => {
  const status = projectWorkspaceStatus({
    seats: [{ id: 'a', title: 'A' }], rooms: [{ id: 'r', title: 'R' }],
    dispatches: [], getSeatRunner: () => undefined, getRoomRunner: () => undefined,
    chairKey: id => `chair:${id}`,
    uncertain: { seats: new Set(['a']), rooms: new Set(['r']) },
  });
  assert.equal(status.seats.get('a'), 'unknown');
  assert.equal(status.rooms.get('r'), 'unknown');
});
