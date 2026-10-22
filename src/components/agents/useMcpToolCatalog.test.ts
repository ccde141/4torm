import assert from 'node:assert/strict';
import test from 'node:test';
import { readMcpToolGroups } from './useMcpToolCatalog';

test('MCP catalog reports transport and shape failures instead of presenting an empty list', async () => {
  await assert.rejects(readMcpToolGroups(async () => new Response('{}', { status: 502 })), /502/);
  for (const body of [{}, { groups: [] }, { groups: { desktop: [{ name: 'observe' }] } }]) {
    await assert.rejects(readMcpToolGroups(async () => Response.json(body)), /格式/);
  }
});

test('MCP catalog preserves names and descriptors without granting tools', async () => {
  const groups = { desktop: [{ name: 'observe', fullName: 'mcp:desktop:observe', description: 'Screenshot' }] };
  assert.deepEqual(await readMcpToolGroups(async () => Response.json({ groups })), groups);
  assert.deepEqual(await readMcpToolGroups(async () => Response.json({ groups: {} })), {});
});
