import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSandboxSection } from './sandbox-prompt.js';

test('旧权限档生成同一份执行策略说明', () => {
  const base = { workspaceAbs: 'C:/workspace', projectDir: 'C:/project' };
  const prompts = (['strict', 'relaxed', 'unrestricted'] as const)
    .map(sandboxLevel => buildSandboxSection({ ...base, sandboxLevel }));

  assert.equal(prompts[0], prompts[1]);
  assert.equal(prompts[1], prompts[2]);
  assert.match(prompts[0], /相对路径.*工作区/);
  assert.match(prompts[0], /绝对路径/);
  assert.match(prompts[0], /控制面/);
  assert.doesNotMatch(prompts[0], /strict|relaxed|unrestricted/);
});
