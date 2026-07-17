import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeetingIdleGuard, MEETING_IDLE_TIMEOUT_MS } from './meeting-idle-guard.js';

test('会议室静默上限为五分钟', () => {
  assert.equal(MEETING_IDLE_TIMEOUT_MS, 300_000);
});

test('静默守卫超时后中止信号', async () => {
  const guard = createMeetingIdleGuard(undefined, 5);
  await new Promise<void>(resolve => guard.signal.addEventListener('abort', () => resolve(), { once: true }));
  assert.equal(guard.timedOut(), true);
  guard.dispose();
});

test('父信号已中止时立即继承中止状态', () => {
  const parent = new AbortController();
  parent.abort();

  const guard = createMeetingIdleGuard(parent.signal);
  const aborted = guard.signal.aborted;
  const timedOut = guard.timedOut();
  guard.dispose();

  assert.equal(aborted, true);
  assert.equal(timedOut, false);
});
