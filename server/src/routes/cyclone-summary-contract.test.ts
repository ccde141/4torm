import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('工作室摘要为关系图提供 Agent 身份与工位职责名片', async () => {
  const source = await fs.readFile(new URL(
    '../modules/cyclone/application/workshop-service.ts', import.meta.url,
  ), 'utf8');
  for (const field of ['id', 'agentId', 'title', 'duty']) {
    assert.match(source, new RegExp(`${field}: seat!\\.${field}`));
  }
});
