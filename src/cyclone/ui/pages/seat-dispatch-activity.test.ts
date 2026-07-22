import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneDispatch } from './dispatch-timeline.js';
import {
  dispatchesRequiringSeatReload,
  findActiveSeatDispatch,
  formatSeatDispatchActivity,
  formatSeatDispatchOrigin,
} from './seat-dispatch-activity.js';

function dispatch(id: string, status: CycloneDispatch['status']): CycloneDispatch {
  return {
    id, workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: id,
    status, readState: 'unread', decisionState: 'pending',
    createdAt: `2026-01-01T00:00:0${id.length}.000Z`, updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('目标工位优先显示正在执行的派发及具体工具目标', () => {
  const queued = dispatch('queued', 'queued');
  const running = {
    ...dispatch('running', 'running'),
    activity: { phase: 'tool-exec' as const, tool: 'write_file', target: 'src/app.ts' },
  };
  const active = findActiveSeatDispatch([queued, running], 'seat-b');
  assert.equal(active?.id, 'running');
  assert.deepEqual(formatSeatDispatchActivity(active!), {
    label: '正在执行 write_file', target: 'src/app.ts',
  });
});

test('派发完成、失败或等待回答时只触发对应工位重载', () => {
  const previous = new Map<string, CycloneDispatch['status']>([
    ['done', 'running'], ['ask', 'running'], ['old', 'completed'],
  ]);
  const items = [
    dispatch('done', 'completed'),
    dispatch('ask', 'awaiting_human'),
    dispatch('old', 'completed'),
    { ...dispatch('other', 'completed'), targetSeatId: 'seat-c' },
  ];
  assert.deepEqual(dispatchesRequiringSeatReload(previous, items, 'seat-b'), ['done', 'ask']);
});

test('目标工位能区分群聊派发与工位私聊派发', () => {
  assert.equal(formatSeatDispatchOrigin(dispatch('room', 'running')), '来自群聊工位');
  assert.equal(formatSeatDispatchOrigin({
    ...dispatch('seat', 'running'), sourceKind: 'seat', sourceRoomId: '',
  }), '来自工位');
});
