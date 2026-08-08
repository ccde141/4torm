import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { FRAMEWORK_TOOLS } from '../tools/framework/catalog.js';

interface RegistryTool {
  name: string;
  executorType: string;
  executorFile?: string;
  parameters?: { type?: string; properties?: Record<string, unknown> };
}

test('framework catalog entries have unique names and matching executors', async () => {
  const dataDir = path.resolve(import.meta.dirname, '../../../data');
  const registry = FRAMEWORK_TOOLS as readonly RegistryTool[];
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
