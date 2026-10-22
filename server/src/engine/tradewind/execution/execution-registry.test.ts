import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionRegistry } from './execution-registry.js';
import { initContactRegistry, findRunnerByLabel, clearContactRegistry, tryRegisterWait } from './contact-registry.js';
import type { NodeRunner } from './node-runner.js';

test('same node IDs are resolved only within the explicit execution and ambiguous legacy lookups fail', () => {
  const registry = new ExecutionRegistry<{ executionId: string; content: string }>(item => item.executionId);
  const a = { executionId: 'A', content: 'private-A' };
  const b = { executionId: 'B', content: 'private-B' };
  registry.set('node', a); registry.set('node', b);
  assert.equal(registry.get('node', 'A'), a);
  assert.equal(registry.get('node', 'B'), b);
  assert.throws(() => registry.get('node'), /execution|执行/);
  assert.throws(() => registry.delete('node'), /execution|执行/);
  registry.delete('node', 'A');
  assert.equal(registry.get('node'), b);
});

test('contact lookup and wait graphs stay execution-local even when node IDs and labels match', () => {
  const a = {} as NodeRunner; const b = {} as NodeRunner;
  try {
    initContactRegistry({ node: 'worker' }, new Map([['node', a]]), 'A');
    initContactRegistry({ node: 'worker' }, new Map([['node', b]]), 'B');
    assert.equal(findRunnerByLabel('worker', 'A')?.runner, a);
    assert.equal(findRunnerByLabel('worker', 'B')?.runner, b);
    assert.throws(() => findRunnerByLabel('worker'), /execution|执行/);
    assert.equal(tryRegisterWait('source', 'target', 'A'), true);
    assert.equal(tryRegisterWait('target', 'source', 'B'), true);
    clearContactRegistry('A');
    assert.equal(findRunnerByLabel('worker', 'B')?.runner, b);
  } finally { clearContactRegistry(); }
});
