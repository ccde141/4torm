import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { MonsoonEvent, MonsoonTurn } from '../runtime/turn-contract.js';
import { runMonsoonTurnStream, type MonsoonStreamOptions,
  type MonsoonStreamRuntime } from './turn-stream.js';

class Response extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  frames: string[] = [];
  write(frame: string): boolean { this.frames.push(frame); return true; }
  end(): void { this.writableEnded = true; this.emit('close'); }
  destroy(): void { this.destroyed = true; this.emit('close'); }
}

function harness(
  execute: (emit: (event: MonsoonEvent) => void) => Promise<unknown>,
  record?: (event: MonsoonEvent) => Promise<void>,
  replyAcceptance?: MonsoonStreamOptions['replyAcceptance'],
) {
  const response = new Response();
  const actions: string[] = [];
  const runner = {
    abort: () => { actions.push('abort'); },
    isSuspended: () => false,
  } as MonsoonTurn;
  const runtime: MonsoonStreamRuntime = {
    markRunning: () => { actions.push('running'); },
    complete: () => { actions.push('complete'); },
    fail: () => { actions.push('fail'); },
  };
  const run = () => runMonsoonTurnStream({
    response, runner, runtime, sessionId: 'session', runId: 'run', agentId: 'agent',
    errorSource: 'test.monsoon', execute, record, replyAcceptance,
  });
  return { response, actions, runner, runtime, run };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('normal turn flushes events and releases the runtime once', async () => {
  const { response, actions, run } = harness(async emit => {
    emit({ type: 'answer', content: 'ok', rawContent: 'ok' });
    emit({ type: 'done' });
  });
  await run();
  assert.deepEqual(actions, ['running', 'complete']);
  assert.equal(response.writableEnded, true);
  assert.match(response.frames.join(''), /"type":"done"/);
});

for (const status of ['completed', 'waiting'] as const) {
  test(`${status} run keeps SSE open until runtime completion`, async () => {
    const entered = deferred();
    const release = deferred();
    const { response, runner, runtime, run } = harness(async emit => {
      emit({ type: 'answer', content: 'ok', rawContent: 'ok' });
      emit({ type: 'done' });
    });
    runner.isSuspended = () => status === 'waiting';
    runtime.complete = async (_session, _runner, _runId, actual) => {
      assert.equal(actual, status);
      entered.resolve();
      await release.promise;
    };
    const pending = run();
    await entered.promise;
    assert.equal(response.writableEnded, false);
    release.resolve();
    await pending;
    assert.equal(response.writableEnded, true);
  });
}

test('failed run keeps SSE open until runtime failure is recorded', async () => {
  const entered = deferred();
  const release = deferred();
  const { response, runtime, run } = harness(async () => { throw new Error('model failed'); });
  runtime.fail = async () => { entered.resolve(); await release.promise; };
  const pending = run();
  await entered.promise;
  assert.equal(response.writableEnded, false);
  assert.doesNotMatch(response.frames.join(''), /"type":"error"/);
  release.resolve();
  await pending;
  assert.equal(response.writableEnded, true);
  assert.match(response.frames.join(''), /"type":"error"/);
});

test('events are durable before they become visible on the SSE response', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const recorded: string[] = [];
  const { response, run } = harness(async emit => {
    emit({ type: 'token', content: 'safe' });
    emit({ type: 'answer', content: 'safe', rawContent: 'safe' });
    emit({ type: 'done' });
  }, async event => {
    if (!recorded.length) await gate;
    recorded.push(event.type);
  });
  const pending = run();
  await Promise.resolve();
  assert.doesNotMatch(response.frames.join(''), /"type":"token"/);
  release();
  await pending;
  assert.deepEqual(recorded, ['token', 'answer', 'done']);
  assert.match(response.frames.join(''), /"type":"done"/);
});

test('reply acceptance waits for running state and durable journal before SSE or execution', async () => {
  const marked = deferred();
  const releaseMark = deferred();
  const recording = deferred();
  const releaseRecord = deferred();
  const steps: string[] = [];
  const accepted = { type: 'reply-accepted' as const, waitingRunId: 'waiting-run', answer: '选项一' };
  const { response, runtime, run } = harness(async emit => {
    steps.push('execute'); emit({ type: 'done' });
  }, async event => {
    if (event.type !== 'reply-accepted') return;
    steps.push('record-start'); recording.resolve();
    await releaseRecord.promise;
    steps.push('recorded');
  }, accepted);
  runtime.markRunning = async () => {
    steps.push('mark-start'); marked.resolve(); await releaseMark.promise; steps.push('marked');
  };
  const pending = run();
  await marked.promise;
  assert.deepEqual(steps, ['mark-start']);
  assert.doesNotMatch(response.frames.join(''), /reply-accepted/);
  releaseMark.resolve();
  await Promise.race([recording.promise,
    pending.then(() => assert.fail('reply completed without recording acceptance'))]);
  assert.deepEqual(steps, ['mark-start', 'marked', 'record-start']);
  assert.doesNotMatch(response.frames.join(''), /reply-accepted/);
  releaseRecord.resolve();
  await pending;
  assert.deepEqual(steps, ['mark-start', 'marked', 'record-start', 'recorded', 'execute']);
  assert.match(response.frames.join(''), /"type":"reply-accepted","waitingRunId":"waiting-run","answer":"选项一"/);
});

test('reply acceptance is never sent when running state or journal write fails', async () => {
  const accepted = { type: 'reply-accepted' as const, waitingRunId: 'waiting-run', answer: '回答' };
  for (const failureAt of ['running', 'journal', 'missing-journal'] as const) {
    let executed = false;
    const record = failureAt === 'missing-journal' ? undefined : async (event: MonsoonEvent) => {
      if (failureAt === 'journal' && event.type === 'reply-accepted') {
        throw new Error('journal failed');
      }
    };
    const { response, runtime, actions, run } = harness(
      async () => { executed = true; }, record, accepted);
    if (failureAt === 'running') runtime.markRunning = () => { throw new Error('running failed'); };
    await run();
    assert.equal(executed, false);
    assert.doesNotMatch(response.frames.join(''), /reply-accepted/);
    assert.match(response.frames.join(''), /"type":"error"/);
    assert.equal(actions.includes('fail'), true);
  }
});

test('disconnect aborts an active turn and failure clears its lease', async () => {
  let reject!: (error: Error) => void;
  const { response, actions, run } = harness(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = run();
  await Promise.resolve();
  response.emit('close');
  reject(new Error('model stopped'));
  await pending;
  assert.deepEqual(actions, ['running', 'abort', 'fail']);
  assert.equal(response.writableEnded, false);
});

test('a synchronous execution failure still releases the reserved turn', async () => {
  const { response, actions, run } = harness(() => { throw new Error('setup failed'); });
  await run();
  assert.deepEqual(actions, ['running', 'fail']);
  assert.equal(response.writableEnded, true);
  assert.match(response.frames.join(''), /"type":"error"/);
});

test('response initialization failure releases the turn without starting execution', async () => {
  const { response, actions } = harness(async () => assert.fail('must not execute'));
  await runMonsoonTurnStream({
    response, runner: { abort() {} } as MonsoonTurn,
    runtime: {
      markRunning: () => { actions.push('running'); },
      complete: () => { actions.push('complete'); },
      fail: () => { actions.push('fail'); },
    },
    sessionId: 'session', runId: 'run', agentId: 'agent', errorSource: 'test.monsoon',
    execute: async () => assert.fail('must not execute'),
    open: () => { throw new Error('headers failed'); },
  });
  assert.deepEqual(actions, ['fail']);
  assert.equal(response.destroyed, true);
});
