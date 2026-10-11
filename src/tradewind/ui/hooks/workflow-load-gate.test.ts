import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowLoadGate } from './workflow-load-gate';

test('a slow first selection cannot replace a later workflow selection', async () => {
  const gate = new WorkflowLoadGate();
  const committed: string[] = [];
  let finishFirst!: (value: string) => void;
  const first = gate.run(() => new Promise<string>(resolve => { finishFirst = resolve; }),
    value => committed.push(value));
  const second = gate.run(async () => 'W2', value => committed.push(value));
  assert.equal(await second, true);
  finishFirst('W1');
  assert.equal(await first, false);
  assert.deepEqual(committed, ['W2']);
});

test('hiding a workflow list prevents its pending refresh from committing', async () => {
  const gate = new WorkflowLoadGate();
  let resolve!: (value: string) => void;
  const committed: string[] = [];
  const pending = gate.run(() => new Promise<string>(done => { resolve = done; }),
    value => committed.push(value));
  gate.invalidate();
  resolve('stale list');
  assert.equal(await pending, false);
  assert.deepEqual(committed, []);
});
