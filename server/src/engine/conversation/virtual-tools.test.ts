import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVirtualToolDefs, shouldAttachToolCaller } from './virtual-tools.js';

test('没有本地工具时仍为可见的虚拟工具挂载执行器', () => {
  const visibleTools = buildVirtualToolDefs();
  assert.equal(shouldAttachToolCaller(visibleTools, false), true);
});

test('完全没有可见工具或拦截器时不挂载执行器', () => {
  assert.equal(shouldAttachToolCaller([], false), false);
});

test('工具注册只在季风可交互会话中可见', () => {
  const interactive = buildVirtualToolDefs(true, true, true).map(tool => tool.name);
  const unattended = buildVirtualToolDefs(true, false, false).map(tool => tool.name);
  assert.equal(interactive.includes('register_tool'), true);
  assert.equal(unattended.includes('register_tool'), false);
});
