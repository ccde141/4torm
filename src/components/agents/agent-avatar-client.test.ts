import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarUrl, validateAvatarFile } from './agent-avatar-client';

test('头像选择允许常见图片并拒绝空文件、非图片与超限文件', () => {
  assert.equal(validateAvatarFile({ type: 'image/png', size: 1024 }), undefined);
  assert.match(validateAvatarFile({ type: 'text/plain', size: 1024 }) || '', /图片/);
  assert.match(validateAvatarFile({ type: 'image/png', size: 0 }) || '', /空/);
  assert.match(validateAvatarFile({ type: 'image/jpeg', size: 21 * 1024 * 1024 }) || '', /20 MB/);
});

test('头像地址编码 Agent 标识并使用版本解除缓存', () => {
  assert.equal(avatarUrl('agent/a', 42), '/api/agents/agent%2Fa/avatar?v=42');
});
