import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeetingIdleGuard, MEETING_IDLE_TIMEOUT_MS, withMeetingIdleGuard } from './meeting-idle-guard.js';
import { callPreparedModel } from '../../shared/react/model-call.js';

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

test('准备与恢复不消耗会议静默预算，正常推理仍受静默上限约束', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const guard = createMeetingIdleGuard(undefined, 50);
  t.after(() => guard.dispose());
  const phases: string[] = [];
  let attempts = 0;
  const llm = withMeetingIdleGuard({
    prepare: async (_messages, _options, signal) => {
      phases.push('prepare');
      // Progress notifications must not accidentally restart the paused timer.
      guard.touch();
      t.mock.timers.tick(100);
      assert.equal(signal?.aborted, false);
    },
    recover: async (_error, _messages, signal) => {
      phases.push('recover');
      guard.touch();
      t.mock.timers.tick(100);
      assert.equal(signal?.aborted, false);
      return true;
    },
    call: async (_messages, _options, onChunk, signal) => {
      phases.push('call');
      t.mock.timers.tick(30);
      assert.equal(signal?.aborted, false);
      if (++attempts === 1) throw new Error('context rejected');
      onChunk?.('still receiving');
      t.mock.timers.tick(30);
      assert.equal(signal?.aborted, false);
      t.mock.timers.tick(21);
      assert.equal(signal?.aborted, true);
      signal?.throwIfAborted();
      return { content: 'unreachable', finishReason: 'stop' };
    },
  }, guard);

  await assert.rejects(callPreparedModel(llm, [], guard.signal, { onChunk: () => guard.touch() }));
  assert.equal(guard.timedOut(), true);
  assert.deepEqual(phases, ['prepare', 'call', 'recover', 'call']);
});

test('暂停静默计时仍响应父级取消，并且不进入实际推理', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parent = new AbortController();
  const reason = new Error('human stopped compaction');
  const guard = createMeetingIdleGuard(parent.signal, 50);
  t.after(() => guard.dispose());
  let calls = 0;
  const llm = withMeetingIdleGuard({
    prepare: async (_messages, _options, signal) => {
      t.mock.timers.tick(100);
      assert.equal(signal?.aborted, false);
      parent.abort(reason);
    },
    call: async () => { calls++; return { content: 'unexpected', finishReason: 'stop' }; },
  }, guard);
  await assert.rejects(callPreparedModel(llm, [], guard.signal, {}), error => error === reason);
  assert.equal(calls, 0);
  assert.equal(guard.timedOut(), false);
});

test('守卫释放后 touch 与 resume 均不会重新创建定时器', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const guard = createMeetingIdleGuard(undefined, 50);
  guard.dispose();
  guard.touch();
  guard.resume();
  t.mock.timers.tick(100);
  assert.equal(guard.signal.aborted, false);
});
