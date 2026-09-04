import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOrganizationRuntime, updateCompletionSignals, updateContactReturnSignals, updateSeatCompletionSignals } from './organization-runtime';
import type { CycloneDispatch } from '../pages/dispatch-timeline';

function dispatch(id: string, status: CycloneDispatch['status']): CycloneDispatch {
  return { id, workshopId: 'w', sourceKind: 'seat', sourceRoomId: '', sourceSeatId: 'a',
    sourceSeatTitle: 'A', sourceTurnId: 't', sourceRoundSeq: 1, dispatchOrder: 0,
    targetSeatId: 'b', targetSeatTitle: 'B', task: 'work', status, readState: 'unread',
    decisionState: 'pending', createdAt: '', updatedAt: '' };
}

test('运行图同时合并工位流和异步派发忙碌态', () => {
  const runtime = deriveOrganizationRuntime(
    [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], [dispatch('d', 'running')],
    id => id === 'a' ? { streaming: true, live: { segments: [] } } : undefined,
  );
  assert.deepEqual([...runtime.busySeatIds].sort(), ['a', 'b']);
  assert.deepEqual([...runtime.activeDispatchPairs], ['a:b']);
});

test('联络过程从流式 contact 块映射为有向线活动', () => {
  const runtime = deriveOrganizationRuntime(
    [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], [],
    id => id === 'a' ? { streaming: true, live: { segments: [{ blocks: [{ kind: 'contact', target: 'B', status: 'running' }] }] } } : undefined,
  );
  assert.deepEqual([...runtime.activeContactPairs], ['a:b']);
});

test('只有从未完成进入 completed 才触发一次绿光', () => {
  const history = updateCompletionSignals({}, new Map(), [dispatch('old', 'completed')]);
  assert.deepEqual(history.signals, {});
  const first = updateCompletionSignals({}, new Map(), [dispatch('d', 'running')]);
  assert.deepEqual(first.signals, {});
  const done = updateCompletionSignals(first.signals, first.statuses, [dispatch('d', 'completed')]);
  assert.equal(done.signals.b, 1);
  const repeated = updateCompletionSignals(done.signals, done.statuses, [dispatch('d', 'completed')]);
  assert.equal(repeated.signals.b, 1);
});

test('contact 只有从 running 进入 success 才触发一次返回脉冲', () => {
  const running = [{ id: 'c', pair: 'a:b', status: 'running' as const }];
  const first = updateContactReturnSignals({}, new Map(), running);
  const done = updateContactReturnSignals(first.signals, first.statuses, [{ ...running[0], status: 'success' }]);
  assert.equal(done.signals['a:b'], 1);
  assert.equal(updateContactReturnSignals(done.signals, done.statuses, [{ ...running[0], status: 'success' }]).signals['a:b'], 1);
});

test('工位 runner 只有从 running 进入 completed 才触发绿光', () => {
  const first = updateSeatCompletionSignals({}, new Map(), [{ seatId: 'a', outcome: 'running' }]);
  const done = updateSeatCompletionSignals(first.signals, first.outcomes, [{ seatId: 'a', outcome: 'completed' }]);
  assert.equal(done.signals.a, 1);
  const failed = updateSeatCompletionSignals(done.signals, done.outcomes, [{ seatId: 'a', outcome: 'failed' }]);
  assert.equal(failed.signals.a, 1);
});
