import assert from 'node:assert/strict';
import test from 'node:test';
import { TideTaskRunGate } from './task-run-gate.js';

test('同一潮汐任务不能并发重入', async () => {
  const gate = new TideTaskRunGate();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let runs = 0;

  const first = gate.run('task-a', async () => {
    runs += 1;
    await hold;
  });
  const duplicate = await gate.run('task-a', async () => { runs += 1; });

  assert.equal(duplicate, undefined);
  assert.equal(runs, 1);
  release();
  await first;
});

test('不同潮汐任务可以同时执行', async () => {
  const gate = new TideTaskRunGate();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const entered: string[] = [];

  const first = gate.run('task-a', async () => {
    entered.push('a');
    await hold;
  });
  const second = gate.run('task-b', async () => { entered.push('b'); });
  await Promise.resolve();

  assert.deepEqual(entered, ['a', 'b']);
  release();
  await Promise.all([first, second]);
});

test('任务失败后会释放重入保护', async () => {
  const gate = new TideTaskRunGate();
  await assert.rejects(gate.run('task-a', async () => { throw new Error('failed'); }), /failed/);

  const result = await gate.run('task-a', async () => 'recovered');
  assert.equal(result, 'recovered');
});
