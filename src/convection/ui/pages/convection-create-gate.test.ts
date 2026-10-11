import assert from 'node:assert/strict';
import test from 'node:test';
import { createConvectionCreateGate } from './convection-create-gate';

test('meeting creation accepts one in-flight action and unlocks after completion', async () => {
  const gate = createConvectionCreateGate();
  let finish!: () => void;
  let started = 0;
  const first = gate.run(async () => {
    started++;
    await new Promise<void>(resolve => { finish = resolve; });
  });
  assert.equal(gate.active, true);
  assert.equal(await gate.run(async () => { started++; }), false);
  assert.equal(started, 1);
  finish();
  assert.equal(await first, true);
  assert.equal(gate.active, false);
  assert.equal(await gate.run(async () => { started++; }), true);
  assert.equal(started, 2);
});

test('meeting creation unlocks after a real failure', async () => {
  const gate = createConvectionCreateGate();
  await assert.rejects(gate.run(async () => { throw new Error('save failed'); }), /save failed/);
  assert.equal(gate.active, false);
  assert.equal(await gate.run(async () => {}), true);
});
