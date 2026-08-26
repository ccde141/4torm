import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name: string) => fs.readFileSync(`src/components/mcp/${name}`, 'utf8');

test('mcp workspace localizes chrome without changing server configuration values', () => {
  const source = [read('McpPage.tsx'), read('McpServerForm.tsx'), read('McpImportPanel.tsx'), read('McpFieldEditors.tsx')].join('\n');
  assert.match(source, /useLocale/);
  assert.match(source, /mcp\.page\.subtitle/);
  assert.match(source, /mcp\.form\.transport/);
  assert.match(source, /mcp\.import\.title/);
  assert.match(source, /mcp\.fields\.add/);
  assert.match(source, /\{server\.name\}/);
  assert.match(source, /serverEndpoint\(server\)/);
  assert.match(source, /\['stdio', 'streamable-http', 'sse'\]/);
  assert.match(source, /payloadFromForm\(form\)/);
  assert.match(source, /parseMcpConfigJson\(text\)/);
});
