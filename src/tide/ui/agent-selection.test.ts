import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileSelectedAgent } from './agent-selection.js';

test('刷新 Agent 列表时用最新对象替换当前选择', () => {
  const selected = { id: 'a1', name: 'old' };
  const next = [{ id: 'a1', name: 'new' }, { id: 'a2', name: 'other' }];
  assert.deepEqual(reconcileSelectedAgent(selected, next), next[0]);
});

test('当前选择已删除时清空选择', () => {
  assert.equal(reconcileSelectedAgent({ id: 'a1' }, [{ id: 'a2' }]), null);
});

test('没有当前选择时保持空值', () => {
  assert.equal(reconcileSelectedAgent(null, [{ id: 'a1' }]), null);
});
