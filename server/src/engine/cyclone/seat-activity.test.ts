import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginExternalSeatActivity,
  clearExternalSeatActivities,
  readExternalSeatActivity,
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
