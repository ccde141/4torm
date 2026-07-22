import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSandboxSection } from './sandbox-prompt.js';

test('项目级只声明文件工具的项目与工作区边界', () => {
  const base = { workspaceAbs: 'C:/workspace', projectDir: 'C:/project' };
  const prompt = buildSandboxSection({ ...base, sandboxLevel: 'project' });

  assert.match(prompt, /相对路径.*工作区/);
  assert.match(prompt, /项目级/);
  assert.match(prompt, /文件工具/);
  assert.match(prompt, /项目目录和当前工作区/);
  assert.match(prompt, /控制面/);
  assert.doesNotMatch(prompt, /strict|relaxed/);
});

test('无限制明确允许文件工具访问外部路径', () => {
  const prompt = buildSandboxSection({
    workspaceAbs: 'C:/workspace',
    projectDir: 'C:/project',
    sandboxLevel: 'unrestricted',
  });

  assert.match(prompt, /无限制/);
  assert.match(prompt, /外部路径/);
  assert.match(prompt, /控制面/);
});
