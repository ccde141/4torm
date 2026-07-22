import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_TOOLS, mergeBuiltinToolDefaults, type ToolDef } from './tools.js';

function staleRunCommand(): ToolDef {
  return {
    name: 'run_command',
    description: '保留用户已有描述',
    category: 'system',
    dangerous: true,
    executorType: 'builtin',
    executorFile: 'run_command',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: '命令' } },
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

test('种子迁移只补缺失参数并保持幂等', () => {
  const first = mergeBuiltinToolDefaults([staleRunCommand()]);
  const migrated = first.tools.find(tool => tool.name === 'run_command');
  const properties = migrated?.parameters.properties as Record<string, unknown>;

  assert.equal(first.changed, true);
  assert.equal(migrated?.description, '保留用户已有描述');
  assert.equal((properties.timeout as { type: string }).type, 'integer');

  const second = mergeBuiltinToolDefaults(first.tools);
  assert.equal(second.changed, false);
  assert.deepEqual(second.tools, first.tools);
});
