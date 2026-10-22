import assert from 'node:assert/strict';
import test from 'node:test';
import { MonsoonRuntime } from './runtime.js';
import type { MonsoonRunRecord } from '../domain/run-record.js';
import type { MonsoonRunRepository } from '../infrastructure/run-repository.js';
import { MonsoonRunnerAdapter } from '../runtime/runner-adapter.js';
import { AgentCollaborationTools } from '../../../engine/conversation/agent-collaboration-tools.js';

class MemoryRuns implements MonsoonRunRepository {
  records = new Map<string, MonsoonRunRecord>();
  constructor(initial: MonsoonRunRecord[] = []) {
    for (const record of initial) this.records.set(record.sessionId, record);
  }
  async save(record: MonsoonRunRecord) { this.records.set(record.sessionId, structuredClone(record)); }
  async load() { return [...this.records.values()].map(record => structuredClone(record)); }
  async recover(updatedAt: string) {
    let crashed = 0;
    for (const record of this.records.values()) {
      if (!['queued', 'running', 'waiting'].includes(record.status)) continue;
      crashed++;
      this.records.set(record.sessionId, { ...record, status: 'crashed', phase: 'crashed',
        updatedAt, errorCode: 'MONSOON_PROCESS_RESTARTED', errorMessage: '上次执行随进程结束，无法继续' });
    }
    return { records: await this.load(), crashed };
  }
}

const spec = {
  dataDir: 'unused', agentId: 'agent-a', sessionId: 'session-a', model: 'model-a',
  temperature: 0, toolNames: [], toolMode: 'selected' as const, skillIds: [],
  workspace: '.', sandboxLevel: 'project' as const, native: false,
};

const acquireLease = () => () => {};
const adapter = () => new MonsoonRunnerAdapter(async () => AgentCollaborationTools.empty());

test('runtime publishes persisted run identity through the common probe', async () => {
  const repository = new MemoryRuns();
  const runtime = new MonsoonRuntime(repository, acquireLease,
    () => '2026-09-30T01:00:00.000Z', adapter());
  await runtime.initialize();
  const runner = await runtime.prepare('session-a', spec);
  await runtime.markRunning('session-a', runner, 'run-a');
  assert.deepEqual(runtime.snapshot().items.map(item =>
    [item.operationId, item.runId, item.status]), [['session-a', 'run-a', 'running']]);
  await runtime.complete('session-a', runner, 'run-a', 'completed');
  assert.deepEqual(runtime.snapshot().items.map(item =>
    [item.operationId, item.runId, item.status]), [['session-a', 'run-a', 'completed']]);
  await runtime.shutdown();
});

test('runtime persists terminal state before notifying an exact run waiter', async () => {
  const runtime = new MonsoonRuntime(new MemoryRuns(), acquireLease,
    () => '2026-09-30T01:00:00.000Z', adapter());
  await runtime.initialize();
  const runner = await runtime.prepare('session-a', spec);
  await runtime.markRunning('session-a', runner, 'run-a');
  const changed = new Promise<void>(resolve => {
    runtime.subscribeRun('session-a', 'run-a', resolve);
  });
  await runtime.complete('session-a', runner, 'run-a', 'completed');
  await changed;
  assert.equal(runtime.findRun('session-a', 'run-a')?.status, 'completed');
  await runtime.shutdown();
});

test('startup exposes a prior active run as crashed', async () => {
  const repository = new MemoryRuns([{ schemaVersion: 1, sessionId: 'session-a', runId: 'run-a',
    agentId: 'agent-a', status: 'running', phase: 'streaming',
    updatedAt: '2026-09-30T00:00:00.000Z' }]);
  const runtime = new MonsoonRuntime(repository, acquireLease,
    () => '2026-09-30T01:00:00.000Z', adapter());
  assert.equal(await runtime.initialize(), 1);
  const item = runtime.snapshot().items[0]!;
  assert.equal(item.status, 'crashed');
  assert.equal(item.errorCode, 'MONSOON_PROCESS_RESTARTED');
  await runtime.shutdown();
});

test('run-specific stop cannot abort a newer execution in the same session', async () => {
  const repository = new MemoryRuns();
  const runtime = new MonsoonRuntime(repository, acquireLease,
    () => '2026-09-30T01:00:00.000Z', adapter());
  await runtime.initialize();
  const runner = await runtime.prepare('session-a', spec);
  await runtime.markRunning('session-a', runner, 'run-new');
  await assert.rejects(runtime.abort('session-a', 'run-old'),
    (error: any) => error?.data?.code === 'MONSOON_RUN_MISMATCH');
  assert.equal(runtime.get('session-a'), runner);
  assert.equal(await runtime.abort('session-a', 'run-new'), true);
  await runtime.shutdown();
});

test('waiting run identity follows only the active suspended execution', async () => {
  const runtime = new MonsoonRuntime(new MemoryRuns(), acquireLease,
    () => '2026-09-30T01:00:00.000Z', adapter());
  await runtime.initialize();
  const runner = await runtime.prepare('session-a', spec);
  assert.equal(runtime.getWaitingRunId('session-a', runner), undefined);
  await runtime.markRunning('session-a', runner, 'run-a');
  assert.equal(runtime.getWaitingRunId('session-a', runner), undefined);
  await runtime.complete('session-a', runner, 'run-a', 'waiting');
  assert.equal(runtime.getWaitingRunId('session-a', runner), 'run-a');
  assert.equal(runtime.getWaitingRunId('session-a', { ...runner }), undefined);
  runner.isSuspended = () => true;
  const shutdown = runtime.shutdown();
  assert.equal(runtime.claimResume('session-a', runner), false);
  await shutdown;
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('shutdown waits for prepared turns and prevents them from starting after shutdown', async () => {
  const ready = gate();
  const instance = adapter();
  instance.ready = async () => ready.promise;
  const runtime = new MonsoonRuntime(new MemoryRuns(), acquireLease, undefined, instance);
  const preparing = runtime.prepare('session-a', spec);
  let drained = false;
  const shutdown = runtime.shutdown().then(() => { drained = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(drained, false);
  } finally { ready.resolve(); }
  await assert.rejects(preparing, /季风模块正在关闭/);
  await shutdown;
  await assert.rejects(runtime.prepare('session-b', spec), /季风模块正在关闭/);
  assert.equal(runtime.get('session-a'), undefined);
});

test('shutdown waits for terminal commit, remains idempotent and rejects new execution', async () => {
  const repository = new MemoryRuns();
  const entered = gate();
  const commit = gate();
  repository.save = async record => {
    if (record.status === 'aborted') { entered.resolve(); await commit.promise; }
    repository.records.set(record.sessionId, structuredClone(record));
  };
  const runtime = new MonsoonRuntime(repository, acquireLease, undefined, adapter());
  const runner = await runtime.prepare('session-a', spec);
  await runtime.markRunning('session-a', runner, 'run-a');
  const execution = runtime.trackExecution(() => runtime.complete('session-a', runner, 'run-a', 'aborted'));
  await entered.promise;
  const shutdown = runtime.shutdown();
  assert.equal(runtime.shutdown(), shutdown);
  let drained = false;
  void shutdown.then(() => { drained = true; });
  try {
    await assert.rejects(runtime.trackExecution(async () => assert.fail('must not execute')),
      /季风模块正在关闭/);
    assert.equal(drained, false);
  } finally { commit.resolve(); }
  await Promise.all([execution, shutdown]);
  assert.equal(repository.records.get('session-a')?.status, 'aborted');
});

test('an older execution settlement cannot remove a newer execution from the drain', async () => {
  const runtime = new MonsoonRuntime(new MemoryRuns(), acquireLease, undefined, adapter());
  const first = gate();
  const second = gate();
  const previous = runtime.trackExecution(() => first.promise);
  const current = runtime.trackExecution(() => second.promise);
  first.resolve();
  await previous;
  let drained = false;
  const shutdown = runtime.shutdown().then(() => { drained = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(drained, false);
  } finally { second.resolve(); }
  await Promise.all([current, shutdown]);
});

test('shutdown reports a rejected pending execution without an unhandled rejection', async () => {
  const runtime = new MonsoonRuntime(new MemoryRuns(), acquireLease, undefined, adapter());
  const execution = runtime.trackExecution(async () => { throw new Error('terminal IO failed'); });
  const rejected = assert.rejects(execution, /terminal IO failed/);
  await assert.rejects(runtime.shutdown(), /季风模块关闭失败/);
  await rejected;
});
