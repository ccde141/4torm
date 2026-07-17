import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

interface RegistryTool {
  name: string;
  executorType: string;
  executorFile?: string;
  parameters?: { type?: string; properties?: Record<string, unknown> };
}

test('builtin registry entries have unique names and matching executors', async () => {
  const dataDir = path.resolve(import.meta.dirname, '../../../data');
  const registryPath = path.join(dataDir, 'tools', 'registry.json');
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8')) as RegistryTool[];
  const names = registry.map(tool => tool.name);

  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length > 0);

  for (const tool of registry) {
    assert.equal(tool.parameters?.type, 'object', `${tool.name} must declare object parameters`);
    if (tool.executorType !== 'builtin') continue;
    const executorFile = tool.executorFile || tool.name;
    await fs.access(path.join(dataDir, 'tools', 'executors', `${executorFile}.js`));
  }
});
