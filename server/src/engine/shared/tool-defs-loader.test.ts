import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAgentToolDefs } from './tool-defs-loader.js';

const builtin = {
  name: 'read_file',
  description: 'read',
  executorType: 'builtin',
  executorFile: 'read_file',
};

const custom = {
  name: 'custom_tool',
  description: 'custom',
  executorType: 'custom',
  executorFile: 'custom_tool',
};

const useSkill = {
  name: 'use_skill',
  description: 'load skill',
  executorType: 'builtin',
  executorFile: 'use_skill',
};

async function createDataDir(): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tools-'));
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'skills', 'demo'), { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'tools', 'registry.json'),
    JSON.stringify([builtin, custom, useSkill]),
  );
  await fs.writeFile(
    path.join(dataDir, 'skills', 'demo', 'tools.json'),
    JSON.stringify([{ name: 'skill_tool', description: 'skill', executorType: 'custom' }]),
  );
  return dataDir;
}

async function main(): Promise<void> {
  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, [], [], 'all');
    assert.deepEqual(tools.map(tool => tool.name), ['read_file', 'use_skill']);
  }

  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, [], [], 'selected');
    assert.deepEqual(tools.map(tool => tool.name), []);
  }

  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, ['custom_tool'], []);
    assert.deepEqual(tools.map(tool => tool.name), ['custom_tool']);
  }

  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, [], ['demo'], 'selected');
    assert.deepEqual(tools.map(tool => tool.name), ['use_skill', 'skill_tool']);
  }

  console.log('tool-defs-loader: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
