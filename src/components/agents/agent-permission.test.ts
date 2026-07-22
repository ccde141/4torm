import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAgentPermission } from './agent-permission.js';

test('旧权限值与无效值统一映射为项目级', () => {
  assert.equal(normalizeAgentPermission('strict'), 'project');
  assert.equal(normalizeAgentPermission('relaxed'), 'project');
  assert.equal(normalizeAgentPermission(undefined), 'project');
});

test('无限制保持不变', () => {
  assert.equal(normalizeAgentPermission('unrestricted'), 'unrestricted');
});
