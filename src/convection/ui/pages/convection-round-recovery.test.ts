import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileConvectionCompaction, reconcileConvectionRound } from './convection-round-recovery.js';

test('manual context verification stops after three unreachable reads without claiming rollback', async () => {
  let reads = 0;
  const delays: number[] = [];
  const result = await reconcileConvectionCompaction({ scope: 'public',
    readContext: async () => { reads++; throw new TypeError('offline'); },
    waitForRetry: async ms => { delays.push(ms); },
  });
  assert.deepEqual(result, { status: 'unconfirmed' });
  assert.equal(reads, 3);
  assert.deepEqual(delays, [500, 1500, 3000]);
});

test('manual context verification consumes the committed terminal after a lost response', async () => {
  let reads = 0;
  const committed = { chairCompactionProgress: { type: 'compact-done', id: 'chair-a' } };
  const result = await reconcileConvectionCompaction({ scope: 'chair',
    readContext: async () => {
      reads++;
      if (reads === 1) return undefined;
      if (reads === 2) return { chairCompactionProgress: { type: 'compact-start', id: 'chair-a' } };
      return committed;
    }, waitForRetry: async () => undefined,
  });
  assert.deepEqual(result, { status: 'settled', context: committed });
});

test('a verified running compression keeps waiting for its normal terminal feed', async () => {
  const context = { compactionProgress: { type: 'compact-start', id: 'public-a' } };
  const result = await reconcileConvectionCompaction({ scope: 'public',
    readContext: async () => context, waitForRetry: async () => undefined });
  assert.deepEqual(result, { status: 'running', context });
});

test('a completed server round releases a stranded local stream after committed messages load', async () => {
  const calls: string[] = [];
  const result = await reconcileConvectionRound({
    readRound: async () => ({ status: 'completed', runId: 'run-1' }),
    loadMessages: async () => { calls.push('load'); return ['persisted reply']; },
    settle: messages => { calls.push('settle'); assert.deepEqual(messages, ['persisted reply']); },
  });
  assert.deepEqual(result, { status: 'completed' });
  assert.deepEqual(calls, ['load', 'settle']);
});

test('a failed server round reports its real terminal status after committed messages load', async () => {
  const result = await reconcileConvectionRound({
    readRound: async () => ({ status: 'failed', runId: 'run-1', errorMessage: '模型请求失败' }),
    loadMessages: async () => ['persisted input'],
    settle: (_messages, terminal) => assert.deepEqual(terminal, {
      status: 'failed', runId: 'run-1', errorMessage: '模型请求失败',
    }),
  });
  assert.equal(result.status, 'failed');
});

test('an active server round does not cancel the local stream or reload messages', async () => {
  const result = await reconcileConvectionRound({
    readRound: async () => ({ status: 'running', round: 'public', runId: 'run-1' }),
    loadMessages: async () => { throw new Error('must not reload'); },
    settle: () => { throw new Error('must not settle'); },
  });
  assert.deepEqual(result, { status: 'running', runtime: { round: 'public', runId: 'run-1' } });
});

test('a failed status reload keeps the round visible instead of claiming completion', async () => {
  await assert.rejects(reconcileConvectionRound({
    readRound: async () => ({ status: 'completed', runId: 'run-1' }),
    loadMessages: async () => { throw new Error('status unavailable'); },
    settle: () => { throw new Error('must not settle'); },
  }), /status unavailable/);
});
