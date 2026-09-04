import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginExternalSeatActivity,
  clearExternalSeatActivities,
  readExternalSeatActivity,
  readWorkshopExternalSeatActivities,
} from './seat-activity.js';

test('external seat activity streams incremental events and exposes completion', () => {
  clearExternalSeatActivities();
  const activity = beginExternalSeatActivity('workshop-a', 'seat-b', 'contact', '正在处理联络');
  activity.emit({ type: 'token', content: '第一段' });
  const first = readExternalSeatActivity('workshop-a', 'seat-b');
  assert.equal(first?.running, true);
  assert.equal(first?.events.length, 1);

  activity.emit({ type: 'tool-call', tool: 'read_file' });
  const next = readExternalSeatActivity('workshop-a', 'seat-b', first?.latestSeq);
  assert.deepEqual(next?.events.map(item => item.event.type), ['tool-call']);

  activity.finish();
  assert.equal(readExternalSeatActivity('workshop-a', 'seat-b')?.running, false);
});

test('dispatch can publish a live external seat activity without persisting token text', () => {
  clearExternalSeatActivities();
  const activity = beginExternalSeatActivity('workshop-a', 'seat-b', 'dispatch', '正在执行异步派发');
  activity.emit({ type: 'token', content: '实时正文' });

  const snapshot = readExternalSeatActivity('workshop-a', 'seat-b');
  assert.equal(snapshot?.kind, 'dispatch');
  assert.deepEqual(snapshot?.events.map(item => item.event), [
    { type: 'token', content: '实时正文' },
  ]);
});

test('workshop activity snapshot returns only currently running seats', () => {
  clearExternalSeatActivities();
  const running = beginExternalSeatActivity('workshop-a', 'seat-a', 'contact', '联络中', 'seat-source');
  const finished = beginExternalSeatActivity('workshop-a', 'seat-b', 'dispatch', '派发中');
  finished.finish();
  beginExternalSeatActivity('workshop-other', 'seat-c', 'contact', '其他工作室');

  assert.deepEqual(readWorkshopExternalSeatActivities('workshop-a'), {
    'seat-a': { id: readExternalSeatActivity('workshop-a', 'seat-a')?.id, kind: 'contact', sourceSeatId: 'seat-source' },
  });
  running.finish();
});
