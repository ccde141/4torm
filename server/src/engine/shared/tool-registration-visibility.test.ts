import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildVirtualToolDefs as buildTradewindTools } from '../tradewind/execution/virtual-tools.js';

test('register_tool is not global and Tradewind never exposes it', async () => {
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'tools', 'registry.json'), 'utf8')) as Array<{ name: string }>;
  const tradewind = buildTradewindTools({ allowDelegate: true, contactTargets: ['reviewer'] });
  assert.equal(registry.some(tool => tool.name === 'register_tool'), false);
  assert.equal(tradewind.some(tool => tool.name === 'register_tool'), false);
});
