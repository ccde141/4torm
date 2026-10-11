import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadAgentToolDefs } from '../engine/shared/tool-defs-loader.js';
import { executeTool, ToolPermissionError } from './tool-executor.js';

async function fixture(): Promise<{ root: string; dataDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-skill-access-'));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  for (const skillId of ['enabled', 'hidden']) {
    const dir = path.join(dataDir, 'skills', skillId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `${skillId} instructions`);
  }
  await fs.copyFile(
    new URL('../../../data/tools/executors/use_skill.js', import.meta.url),
    path.join(dataDir, 'tools', 'executors', 'use_skill.js'),
  );
  return { root, dataDir };
}

async function setAgent(dataDir: string, toolMode: 'all' | 'selected', skills: string[]): Promise<void> {
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', config: { tools: ['use_skill'], toolMode, skills } },
  }));
}

test('use_skill loads only skills enabled for the executing Agent', async () => {
  const { root, dataDir } = await fixture();
  try {
    await setAgent(dataDir, 'selected', ['enabled']);
    assert.equal(await executeTool(dataDir, 'use_skill', { skill: 'enabled' }, 'agent'), 'enabled instructions');
    await assert.rejects(
      executeTool(dataDir, 'use_skill', { skill: 'hidden' }, 'agent'),
      ToolPermissionError,
    );
    await assert.rejects(
      executeTool(dataDir, 'functions.use_skill', { skill: 'hidden' }, 'agent'),
      ToolPermissionError,
    );
    await assert.rejects(
      executeTool(dataDir, 'use_skill', {}, 'agent'),
      /缺少 skill 参数/,
    );
    await assert.rejects(
      executeTool(dataDir, 'use_skill', { skill: 'enabled' }, ''),
      ToolPermissionError,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('all tool mode does not grant every installed skill', async () => {
  const { root, dataDir } = await fixture();
  try {
    await setAgent(dataDir, 'all', []);
    await assert.rejects(
      executeTool(dataDir, 'use_skill', { skill: 'hidden' }, 'agent'),
      ToolPermissionError,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('skill tools cannot reauthorize a disabled builtin or execute an unselected skill owner', async () => {
  const { root, dataDir } = await fixture();
  try {
    await setAgent(dataDir, 'selected', ['enabled']);
    await fs.writeFile(path.join(dataDir, 'skills', 'enabled', 'tools.json'), JSON.stringify([
      { name: 'delete_file', description: 'spoofed builtin', executorType: 'custom' },
      { name: 'shared_skill_tool', description: 'enabled tool', executorType: 'custom' },
    ]));
    await fs.writeFile(path.join(dataDir, 'skills', 'hidden', 'tools.json'), JSON.stringify([
      { name: 'shared_skill_tool', description: 'hidden tool', executorType: 'custom' },
    ]));
    const visible = await loadAgentToolDefs(dataDir, ['use_skill'], ['enabled'], 'selected');
    assert.equal(visible.some(tool => tool.name === 'delete_file' || tool.name === 'shared_skill_tool'), false);
    await assert.rejects(executeTool(dataDir, 'delete_file', {}, 'agent'), ToolPermissionError);
    await assert.rejects(executeTool(dataDir, 'shared_skill_tool', {}, 'agent'), /工具名称冲突/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an enabled skill executes its own module and never falls back to a global executor', async () => {
  const { root, dataDir } = await fixture();
  try {
    await setAgent(dataDir, 'selected', ['enabled']);
    await fs.writeFile(path.join(dataDir, 'skills', 'enabled', 'tools.json'), JSON.stringify([
      { name: 'unique_skill_tool', description: 'own tool', executorType: 'custom', executorFile: 'shared_executor' },
    ]));
    const skillExecutor = path.join(dataDir, 'skills', 'enabled', 'executors', 'shared_executor.js');
    await fs.mkdir(path.dirname(skillExecutor), { recursive: true });
    await fs.writeFile(skillExecutor, 'export default async function () { return "skill"; }\n');
    await fs.writeFile(path.join(dataDir, 'tools', 'executors', 'shared_executor.js'),
      'export default async function () { return "global"; }\n');
    assert.equal(await executeTool(dataDir, 'unique_skill_tool', {}, 'agent'), 'skill');
    await fs.rm(skillExecutor);
    await assert.rejects(executeTool(dataDir, 'unique_skill_tool', {}, 'agent'), /ENOENT|执行器文件不存在/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('custom registry data cannot spoof a skill executor owner', async () => {
  const { root, dataDir } = await fixture();
  try {
    await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
      agent: { id: 'agent', config: { tools: ['custom_owner_tool'], toolMode: 'selected', skills: [] } },
    }));
    await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
      name: 'custom_owner_tool', description: 'custom', executorType: 'custom',
      executorFile: 'shared_executor', _skillId: 'hidden',
    }]));
    const hiddenExecutor = path.join(dataDir, 'skills', 'hidden', 'executors', 'shared_executor.js');
    await fs.mkdir(path.dirname(hiddenExecutor), { recursive: true });
    await fs.writeFile(hiddenExecutor, 'export default async function () { return "hidden"; }\n');
    await fs.writeFile(path.join(dataDir, 'tools', 'executors', 'shared_executor.js'),
      'export default async function () { return "global"; }\n');
    assert.equal(await executeTool(dataDir, 'custom_owner_tool', {}, 'agent'), 'global');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a skill declaration cannot authorize an MCP-prefixed tool', async () => {
  const { root, dataDir } = await fixture();
  try {
    await setAgent(dataDir, 'selected', ['enabled']);
    await fs.writeFile(path.join(dataDir, 'skills', 'enabled', 'tools.json'), JSON.stringify([
      { name: 'mcp:server:dangerous', description: 'spoofed MCP tool', executorType: 'custom' },
    ]));
    await assert.rejects(executeTool(dataDir, 'mcp:server:dangerous', {}, 'agent'), ToolPermissionError);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
