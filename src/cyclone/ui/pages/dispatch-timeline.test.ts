import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDispatchTimeline,
  countPendingDispatches,
  selectVisibleSeatDispatches,
  type CycloneDispatch,
  type TimelineMessage,
} from './dispatch-timeline.js';
import { publicToFeed } from './room-messages.js';

function dispatch(id: string, turnId: string, order: number): CycloneDispatch {
  return {
    id, workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: turnId, sourceRoundSeq: 1,
    dispatchOrder: order, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: id,
    status: 'completed', readState: 'unread', decisionState: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('派发卡紧跟来源回复并按调用顺序排列', () => {
  const messages: TimelineMessage[] = [
    { key: 'human', turnId: undefined },
    { key: 'agent-a', turnId: 'turn-a' },
    { key: 'agent-b', turnId: 'turn-b' },
  ];
  const timeline = buildDispatchTimeline(messages, [
    dispatch('second', 'turn-a', 1),
    dispatch('third', 'turn-b', 0),
    dispatch('first', 'turn-a', 0),
  ]);

  assert.deepEqual(timeline.map(item => (
    item.kind === 'message' ? item.message.key : item.dispatch.id
  )), ['human', 'agent-a', 'first', 'second', 'agent-b', 'third']);
});

test('找不到来源回复的派发仍保留在时间线末尾', () => {
  const timeline = buildDispatchTimeline([{ key: 'human' }], [dispatch('orphan', 'old-turn', 0)]);
  assert.deepEqual(timeline.map(item => item.kind), ['message', 'dispatch']);
});

test('未处理数量只统计已经结束且仍待决策的派发', () => {
  const completed = dispatch('done', 'turn-a', 0);
  const running = { ...dispatch('running', 'turn-a', 1), status: 'running' as const };
  const dismissed = { ...dispatch('ignored', 'turn-a', 2), decisionState: 'dismissed' as const };
  assert.equal(countPendingDispatches([completed, running, dismissed]), 1);
});

test('带入讨论的系统消息保留为人类侧异步回执而非归档摘要', () => {
  const [message] = publicToFeed([{
    id: 'dispatch-result-a', speaker: '系统', content: '异步任务完成', timestamp: 1,
    kind: 'dispatch-result', dispatchId: 'dispatch-a',
  }]);
  assert.equal(message.kind, 'dispatch-result');
  assert.equal(message.isArchiveSummary, false);
  assert.equal(message.dispatchId, 'dispatch-a');
});

test('源工位只显示尚未由持久化回执接替的私聊派发', () => {
  const active = {
    ...dispatch('seat-active', 'turn-a', 0), sourceKind: 'seat' as const,
    sourceRoomId: '', sourceSeatId: 'seat-a', receiptState: 'pending' as const,
  };
  const delivered = { ...active, id: 'seat-delivered', receiptState: 'delivered' as const };
  const room = dispatch('room', 'turn-a', 1);
  const other = { ...active, id: 'seat-other', sourceSeatId: 'seat-c' };

  assert.deepEqual(
    selectVisibleSeatDispatches([active, delivered, room, other], 'seat-a').map(item => item.id),
    ['seat-active'],
  );
});
