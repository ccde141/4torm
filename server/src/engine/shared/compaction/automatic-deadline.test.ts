import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { automaticCompactionDeadline, AUTOMATIC_COMPACTION_TIMEOUT_MS } from './automatic-deadline.js';
import { compactMessages } from './controller.js';
import type { CompactionProgress, CompactionReason } from './contracts.js';
import { defaultCompactionPolicy } from './policy.js';
import { compactionRequestDeadline, CompactionRequestTimeout } from './request-deadline.js';

const MINUTE = 60_000;

test('automatic compaction has one two-hour deadline independent of fragment progress', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const deadline = automaticCompactionDeadline();
  try {
    t.mock.timers.tick(60 * MINUTE);
    assert.equal(deadline.signal.aborted, false);
    t.mock.timers.tick(60 * MINUTE - 1);
    assert.equal(deadline.signal.aborted, false);
    t.mock.timers.tick(1);
    assert.ok(deadline.signal.reason instanceof CompactionRequestTimeout);
    assert.match(deadline.signal.reason.message, /自动压缩超时（2 小时）/);
  } finally { deadline.dispose(); }
});

test('human cancellation propagates and disposing an automatic deadline releases its timer and listener', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parent = new AbortController();
  const active = automaticCompactionDeadline(parent.signal);
  const stopped = automaticCompactionDeadline(parent.signal);
  stopped.dispose();
  const reason = new Error('human stopped');
  parent.abort(reason);
  assert.equal(active.signal.reason, reason);
  active.dispose();
  t.mock.timers.tick(AUTOMATIC_COMPACTION_TIMEOUT_MS);
  assert.equal(stopped.signal.aborted, false);
  const alreadyStopped = automaticCompactionDeadline(parent.signal);
  assert.equal(alreadyStopped.signal.reason, reason);
  alreadyStopped.dispose();
});

test('automatic requests can continue beyond fifteen minutes while idle requests still stop', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = compactionRequestDeadline(undefined, { totalMs: AUTOMATIC_COMPACTION_TIMEOUT_MS });
  try {
    for (let minutes = 0; minutes < 118; minutes += 2) {
      t.mock.timers.tick(2 * MINUTE);
      request.touch();
      assert.equal(request.signal.aborted, false);
    }
    t.mock.timers.tick(2 * MINUTE);
    assert.match(request.signal.reason.message, /片段生成超时/);
  } finally { request.dispose(); }
  const idle = compactionRequestDeadline(undefined, { totalMs: AUTOMATIC_COMPACTION_TIMEOUT_MS });
  try {
    t.mock.timers.tick(3 * MINUTE);
    assert.match(idle.signal.reason.message, /长时间未响应/);
  } finally { idle.dispose(); }
});

test('manual requests retain the fifteen-minute ceiling', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = compactionRequestDeadline();
  try {
    for (let minute = 0; minute < 14; minute++) {
      t.mock.timers.tick(MINUTE);
      request.touch();
    }
    assert.equal(request.signal.aborted, false);
    t.mock.timers.tick(MINUTE);
    assert.match(request.signal.reason.message, /片段生成超时/);
  } finally { request.dispose(); }
});

for (const reason of ['threshold', 'provider-overflow'] as const) {
  test(`${reason}: a multi-stage timeout preserves original context and reports failure rather than human cancellation`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const messages: ContextMessage[] = [{ role: 'user', content: '原'.repeat(30_000) },
      { role: 'assistant', content: 'result' }];
    const original = structuredClone(messages);
    const progress: CompactionProgress[] = [];
    let calls = 0;
    let commits = 0;
    await assert.rejects(compactMessages({ ...input(reason), messages,
      onProgress: event => { progress.push(event); },
      summarize: async request => {
        assert.equal(request.requestTimeoutMs, AUTOMATIC_COMPACTION_TIMEOUT_MS);
        calls++;
        // Both individual fragments fit within two hours, but their combined job does not.
        t.mock.timers.tick(calls === 1 ? 61 * MINUTE : 59 * MINUTE);
        request.signal?.throwIfAborted();
        return 'retained facts';
      },
      commit: async () => { commits++; },
    }), /自动压缩超时/);
    assert.equal(calls, 2);
    assert.equal(commits, 0);
    assert.deepEqual(messages, original);
    assert.equal(progress.at(-1)?.type, 'compact-failed');
    assert.equal(progress.at(-1)?.aborted, false);
    assert.ok(!progress.some(event => event.type === 'compact-done'));
  });
}

test('successful automatic compaction releases its deadline before later model work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  const plan = await compactMessages({ ...input('threshold'),
    messages: [{ role: 'user', content: '记录'.repeat(500) }],
    summarize: async request => { signal = request.signal; return 'retained facts'; },
  });
  assert.ok(plan);
  t.mock.timers.tick(AUTOMATIC_COMPACTION_TIMEOUT_MS);
  assert.equal(signal?.aborted, false);
});

test('an automatic timeout reported by a provider as AbortError keeps the timeout reason', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let failed: CompactionProgress | undefined;
  await assert.rejects(compactMessages({ ...input('threshold'),
    messages: [{ role: 'user', content: '记录'.repeat(500) }],
    onProgress: event => { failed = event; },
    summarize: async () => {
      t.mock.timers.tick(AUTOMATIC_COMPACTION_TIMEOUT_MS);
      throw new DOMException('The operation was aborted', 'AbortError');
    },
  }), /自动压缩超时/);
  assert.equal(failed?.aborted, false);
});

test('expiry during durable commit cannot undo success or hide a storage failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const fails of [false, true]) {
    const messages: ContextMessage[] = [{ role: 'user', content: '记录'.repeat(500) }];
    const original = structuredClone(messages);
    const operation = compactMessages({ ...input('threshold'), messages,
      summarize: async () => 'retained facts',
      commit: async () => {
        t.mock.timers.tick(AUTOMATIC_COMPACTION_TIMEOUT_MS);
        if (fails) throw new Error('disk full');
      },
    });
    if (fails) {
      await assert.rejects(operation, /disk full/);
      assert.deepEqual(messages, original);
    } else {
      const plan = await operation;
      assert.deepEqual(messages, plan?.messages);
    }
  }
});

function input(reason: CompactionReason) {
  return { dataDir: '', area: 'monsoon' as const, model: 'p:current', kind: 'conversation' as const,
    mode: 'full' as const, reason, policy: defaultCompactionPolicy(),
    resolveSummaryBudget: async () => 16_000 };
}
