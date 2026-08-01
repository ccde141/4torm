import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_TOOLS, mergeBuiltinToolDefaults, type ToolDef } from './tools.js';

function staleRunCommand(): ToolDef {
  return {
    name: 'run_command',
    description: '在终端执行一条系统命令',
    category: 'system',
    dangerous: true,
    executorType: 'builtin',
    executorFile: 'run_command',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: '要执行的 shell 命令' } },
      required: ['command'],
    },
  };
}

test('run_command 种子公开可选 timeout 参数', () => {
  const runCommand = BUILTIN_TOOLS.find(tool => tool.name === 'run_command');
  const properties = runCommand?.parameters.properties as Record<string, unknown>;
  assert.deepEqual(properties.timeout, {
    type: 'integer',
    description: '可选，超时毫秒数；范围 1000 至 600000，默认 120000',
  });
  assert.deepEqual(runCommand?.parameters.required, ['command']);
});

test('种子迁移补齐 run_command 契约并保持幂等', () => {
  const first = mergeBuiltinToolDefaults([staleRunCommand()]);
  const migrated = first.tools.find(tool => tool.name === 'run_command');
  const properties = migrated?.parameters.properties as Record<string, unknown>;

  assert.equal(first.changed, true);
  assert.match(migrated?.description ?? '', /Windows 使用 cmd\.exe/);
  assert.match((properties.command as { description: string }).description, /分隔命令请使用 &、&& 或 \|\|/);
  assert.equal((properties.timeout as { type: string }).type, 'integer');

  const second = mergeBuiltinToolDefaults(first.tools);
  assert.equal(second.changed, false);
  assert.deepEqual(second.tools, first.tools);
});
