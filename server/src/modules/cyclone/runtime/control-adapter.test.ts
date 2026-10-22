import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneRunRepository } from '../infrastructure/run-repository.js';
import { createCycloneCommands } from './control-adapter.js';
import { CycloneExecutionRegistry } from './execution-registry.js';
import { shutdownCyclonePreparations } from '../application/execution-preparation.js';

function registry(lock: { held: boolean }): CycloneExecutionRegistry {
  const acquire = () => {
    if (lock.held) return null;
    lock.held = true;
    return () => { lock.held = false; };
  };
  return new CycloneExecutionRegistry({ seat: acquire, room: acquire });
}

const target = {
  workshopId: 'workshop-a', targetKind: 'seat' as const,
  targetId: 'seat-a', phase: 'seat-chat' as const,
};

test('气旋运行记录启动失败时释放已取得的目标锁', async () => {
  const lock = { held: false };
  const executions = registry(lock);
  const commands = createCycloneCommands(executions, {
    start: async () => { throw new Error('disk failed'); },
  } as unknown as CycloneRunRepository);
  await assert.rejects(commands.begin(target), /disk failed/);
  assert.equal(lock.held, false);
  assert.doesNotThrow(() => executions.begin(target));
});

test('气旋终态写入失败仍释放目标锁并真实抛错', async () => {
  const lock = { held: false };
  const executions = registry(lock);
  const commands = createCycloneCommands(executions, {
    start: async input => ({ ...input, status: 'running', updatedAt: input.startedAt }),
    finish: async () => { throw new Error('terminal write failed'); },
  } as unknown as CycloneRunRepository);
  const receipt = await commands.begin(target);
  await assert.rejects(commands.finish({
    operationId: receipt.operationId, runId: receipt.runId, status: 'failed',
  }), /terminal write failed/);
  assert.equal(lock.held, false);
  assert.deepEqual(executions.list(), []);
});

test('关闭与运行事实启动写入并发时等待准备收口，不遗留 running 或锁', async () => {
  const lock = { held: false };
  const executions = registry(lock);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const starting = new Promise<void>(resolve => { entered = resolve; });
  let status = 'running';
  const commands = createCycloneCommands(executions, {
    start: async () => { entered(); await gate; },
    finish: async (_operation, _run, next) => { status = next; },
  } as unknown as CycloneRunRepository);
  const begin = commands.begin(target);
  const rejected = assert.rejects(begin, /正在关闭/);
  await starting;
  const shutdown = shutdownCyclonePreparations(commands);
  release();
  await Promise.all([shutdown, rejected]);
  assert.equal(status, 'aborted');
  assert.equal(lock.held, false);
  assert.deepEqual(executions.list(), []);
  await assert.rejects(commands.begin(target), /正在关闭/);
});
