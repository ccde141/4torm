import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('tools catalog localizes shell and cards without translating tool payloads', () => {
  const source = fs.readFileSync('src/components/tools/ToolsPage.tsx', 'utf8');
  assert.match(source, /useLocale/);
  assert.match(source, /tools\.page\.title/);
  assert.match(source, /tools\.card\.readonly/);
  assert.match(source, /\{tool\.name\}/);
  assert.match(source, /\{tool\.description\}/);
  assert.match(source, /JSON\.stringify\(tool\.parameters/);
  assert.match(source, /tool\.executionMode === 'detachable'/);
});

test('tool form localizes guidance without changing saved protocol values', () => {
  const source = fs.readFileSync('src/components/tools/ToolsPage.tsx', 'utf8');
  assert.match(source, /tools\.form\.invalidJson/);
  assert.match(source, /tools\.form\.executionLifecycle/);
  assert.match(source, /tools\.form\.schemaTemplates/);
  assert.match(source, /\(\['sync', 'detachable'\] as const\)/);
  assert.match(source, /\(\['template', 'custom'\] as const\)/);
  assert.match(source, /JSON\.parse\(paramsJson\)/);
  assert.match(source, /name: name\.trim\(\), description, category, dangerous, executorType/);
  assert.match(source, /executorFile: executorFile \|\| undefined/);
});
