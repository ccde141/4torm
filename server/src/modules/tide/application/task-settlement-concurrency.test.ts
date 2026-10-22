import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionRunner } from '../../../engine/conversation/session-runner.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import { createTideFeature } from '../api/factory.js';
import type { TideTask } from '../domain/task.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { runTideTask } from '../runtime/runner.js';
import { TideRunControl } from '../runtime/run-control.js';

for (const aborted of [false, true]) {
  test(`${aborted ? '主动中止' : '成功'}收尾与暂停并发时，不恢复旧启用状态且保留本轮结算信息`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-settlement-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    const registry = agentRegistryFile(dataDir);
    await fs.mkdir(path.dirname(registry), { recursive: true });
    await fs.writeFile(registry, JSON.stringify({ worker: { id: 'worker', name: 'Worker',
      model: 'test:local', config: { tools: ['no-network-test'], toolMode: 'selected' } } }));
    const task: TideTask = { id: 'settlement', name: '结算回归', agentId: 'worker',
      schedule: 'daily 08:00', prompt: '检查', repeatCount: 5, pushMode: 'accumulate',
      windowN: 4, selfLoop: false, consecutiveErrors: 2, enabled: true,
      createdAt: new Date().toISOString() };
    const repository = new FileTideTaskRepository(dataDir);
    const runs = new FileTideRunRepository(dataDir);
    const feature = createTideFeature({ dataDir });
    await repository.upsert(task);
    const reading = deferred();
    const releaseRead = deferred();
    const pauseQueued = deferred();
    const control = new TideRunControl(task.id, 'settlement-run');
    let modelReturned = false;
    let held = false;
    const read = repository.read.bind(repository);
    t.mock.method(repository, 'read', async () => {
      const snapshot = await read();
      if (modelReturned && !held) {
        held = true; reading.resolve(); await releaseRead.promise;
      }
      return snapshot;
    });
    const mutate = FileTideTaskRepository.prototype.mutate;
    t.mock.method(FileTideTaskRepository.prototype, 'mutate', function(
      this: FileTideTaskRepository, ...args: Parameters<typeof mutate>
    ) {
      const result = mutate.apply(this, args);
      if (this !== repository) pauseQueued.resolve();
      return result;
    });
    t.mock.method(SessionRunner.prototype, 'chat', async () => {
      modelReturned = true;
      if (aborted) { control.abort(); control.signal.throwIfAborted(); }
      return { content: '检查完成', rawContent: '检查完成' };
    });
    const execution = runTideTask({ dataDir, tasks: repository, runs, runControl: control },
      task, false, control.runId);
    await reading.promise;
    const paused = feature.tasks.setEnabled(task.id, false);
    await pauseQueued.promise;
    releaseRead.resolve();
    const [record] = await Promise.all([execution, paused]);
    const stored = await repository.get(task.id);
    assert.equal(record.status, aborted ? 'aborted' : 'success');
    assert.equal(stored?.enabled, false);
    assert.ok(stored?.lastRun);
    assert.equal(stored.schedule, 'daily 08:00');
    assert.equal(stored.agentId, 'worker');
    assert.equal(stored.repeatCount, aborted ? 5 : 4);
    assert.equal(stored.consecutiveErrors, aborted ? 2 : 0);
    if (!aborted) assert.equal(stored.targetSessionId, record.sessionId);
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
