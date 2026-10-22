import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSandboxSection } from './sandbox-prompt.js';
import { buildExecutionEnvironmentSection } from './execution-environment-prompt.js';

test('Linux 环境事实与实际命令工具的 POSIX sh 契约一致', () => {
  const prompt = buildExecutionEnvironmentSection('linux');

  assert.match(prompt, /Linux \(linux\)/);
  assert.match(prompt, /`\/bin\/sh`/);
  assert.match(prompt, /不要假定.*Bash/);
  assert.match(prompt, /后端宿主机/);
  assert.match(prompt, /不能.*其他平台.*原样/);
  assert.doesNotMatch(prompt, /cmd\.exe|PowerShell/);
});

test('Windows 明确使用 cmd.exe，其他平台保持实际的 sh 契约', () => {
  const windows = buildExecutionEnvironmentSection('win32');
  const mac = buildExecutionEnvironmentSection('darwin');

  assert.match(windows, /Windows \(win32\)/);
  assert.match(windows, /`cmd\.exe`/);
  assert.match(windows, /不是 PowerShell/);
  assert.match(windows, /`;` 不是命令分隔符/);
  assert.doesNotMatch(windows, /\/bin\/sh/);
  assert.match(mac, /macOS \(darwin\)/);
  assert.match(mac, /`\/bin\/sh`/);
});

test('共享工作区段恰好注入一次当前后端的真实执行环境', () => {
  const prompt = buildSandboxSection({
    workspaceAbs: 'workspace', projectDir: 'project', sandboxLevel: 'project',
  });
  const environment = buildExecutionEnvironmentSection();

  assert.ok(prompt.startsWith(environment));
  assert.equal(prompt.split('## 执行环境（后端宿主）').length - 1, 1);
  assert.match(prompt, new RegExp(`\\(${process.platform}\\)`));
});

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
