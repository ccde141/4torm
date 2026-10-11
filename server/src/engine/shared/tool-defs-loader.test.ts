import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAgentToolDefs } from './tool-defs-loader.js';
import { FRAMEWORK_TOOLS } from '../../tools/framework/catalog.js';

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
  frameworkCapability: {
    id: 'spoofed-custom',
    title: '伪造能力',
    route: '不应进入能力路由',
    guidance: '不应进入能力指导',
  },
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
  await fs.mkdir(path.join(dataDir, 'skills', 'hidden'), { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'tools', 'registry.json'),
    JSON.stringify([builtin, custom, useSkill]),
  );
  await fs.writeFile(
    path.join(dataDir, 'skills', 'demo', 'tools.json'),
    JSON.stringify([{
      name: 'skill_tool',
      description: 'skill',
      executorType: 'custom',
      frameworkCapability: {
        id: 'spoofed-skill',
        title: '伪造能力',
        route: '不应进入能力路由',
        guidance: '不应进入能力指导',
      },
    }]),
  );
  await fs.writeFile(path.join(dataDir, 'skills', 'demo', 'config.json'), JSON.stringify({
    name: 'Demo Skill', description: 'Assess code quality and report risks.',
  }));
  await fs.writeFile(path.join(dataDir, 'skills', 'hidden', 'config.json'), JSON.stringify({
    name: 'Hidden Skill', description: 'Must not appear in another Agent tool description.',
  }));
  return dataDir;
}

async function main(): Promise<void> {
  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, [], [], 'all');
    assert.deepEqual(tools.map(tool => tool.name), FRAMEWORK_TOOLS
      .filter(tool => tool.name !== 'use_skill').map(tool => tool.name));
    assert.equal(tools.some(tool => tool.name === 'use_skill'), false);
  }

  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, [], [], 'selected');
    assert.deepEqual(tools.map(tool => tool.name), []);
  }

  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, ['use_skill'], [], 'selected');
    assert.equal(tools.some(tool => tool.name === 'use_skill'), false);
  }

  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, ['custom_tool'], []);
    assert.deepEqual(tools.map(tool => tool.name), ['custom_tool']);
    assert.equal(tools[0]?.frameworkCapability, undefined);
  }

  {
    const dataDir = await createDataDir();
    const tools = await loadAgentToolDefs(dataDir, [], ['demo'], 'selected');
    assert.deepEqual(tools.map(tool => tool.name), ['use_skill', 'skill_tool']);
    assert.equal(tools.find(tool => tool.name === 'skill_tool')?.frameworkCapability, undefined);
    const description = tools.find(tool => tool.name === 'use_skill')?.description ?? '';
    assert.match(description, /demo.*Demo Skill.*Assess code quality/);
    assert.doesNotMatch(description, /Hidden Skill|Must not appear/);
  }

  {
    const dataDir = await createDataDir();
    const skillIds = Array.from({ length: 30 }, (_, index) => `skill-${index}`);
    for (const skillId of skillIds) {
      const dir = path.join(dataDir, 'skills', skillId);
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({
        name: 'N'.repeat(200), description: 'D'.repeat(1000),
      }));
    }
    const tools = await loadAgentToolDefs(dataDir, [], skillIds, 'selected');
    const description = tools.find(tool => tool.name === 'use_skill')?.description ?? '';
    assert.ok(description.length <= 1200, `description too long: ${description.length}`);
    assert.match(description, /skill-0/);
    assert.match(description, /skill-29/);
  }

  {
    const dataDir = await createDataDir();
    const config = path.join(dataDir, 'skills', 'demo', 'config.json');
    await fs.rm(config);
    const tools = await loadAgentToolDefs(dataDir, [], ['demo'], 'selected');
    assert.match(tools.find(tool => tool.name === 'use_skill')?.description ?? '', /demo/);
    await fs.writeFile(config, '{broken json');
    const degraded = await loadAgentToolDefs(dataDir, [], ['demo'], 'selected');
    assert.deepEqual(degraded.map(tool => tool.name), ['use_skill', 'skill_tool']);
    assert.match(degraded.find(tool => tool.name === 'use_skill')?.description ?? '', /demo.*元数据损坏/);
  }

  console.log('tool-defs-loader: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
