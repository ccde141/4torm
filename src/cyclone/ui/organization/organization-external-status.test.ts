import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeExternalRunningSeatStatuses, projectExternalActivity } from './organization-external-status.js';

test('后端外部活动把对应工位投影为运行中且不改原状态表', () => {
  const original = new Map([['seat-a', 'idle' as const], ['seat-b', 'waiting' as const]]);
  const merged = mergeExternalRunningSeatStatuses(original, new Set(['seat-b']));

  assert.equal(original.get('seat-b'), 'waiting');
  assert.equal(merged.get('seat-a'), 'idle');
  assert.equal(merged.get('seat-b'), 'running');
});

test('没有外部活动时复用原状态表', () => {
  const original = new Map([['seat-a', 'idle' as const]]);
  assert.equal(mergeExternalRunningSeatStatuses(original, new Set()), original);
});

test('后端联络与派发活动投影为有向关系线且忽略无来源活动', () => {
  const projected = projectExternalActivity({
    runningSeatIds: ['seat-b', 'seat-c', 'seat-d'],
    activities: {
      'seat-b': { id: 'contact-1', kind: 'contact', sourceSeatId: 'seat-a' },
      'seat-c': { id: 'dispatch-1', kind: 'dispatch', sourceSeatId: 'seat-a' },
      'seat-d': { id: 'intro-1', kind: 'join-summary' },
    },
  });

  assert.deepEqual([...projected.runningSeatIds].sort(), ['seat-b', 'seat-c', 'seat-d']);
  assert.deepEqual([...projected.activeContactPairs], ['seat-a:seat-b']);
  assert.deepEqual([...projected.activeDispatchPairs], ['seat-a:seat-c']);
});
