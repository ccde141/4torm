import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('capability pages receive their active state instead of relying on one mount', () => {
  const app = source('App.tsx');
  assert.match(app, /<ToolsPage active=\{page === 'tools'\}/);
  assert.match(app, /<SkillsPage active=\{page === 'skills'\}/);
});

test('tools and skills refresh on demand without periodic polling', () => {
  const tools = source('components/tools/ToolsPage.tsx');
  const skills = source('components/skills/SkillsPage.tsx');
  const refresh = source('components/capabilities/useActiveCapabilityList.ts');

  assert.match(tools, /useActiveCapabilityList\(active, getTools/);
  assert.match(skills, /useActiveCapabilityList\(active, listSkills/);
  assert.match(refresh, /window\.addEventListener\('focus'/);
  assert.doesNotMatch(refresh, /setInterval/);
  assert.match(refresh, /generation\.current/);
  assert.match(tools, /t\('tools\.page\.refresh'\)/);
  assert.match(skills, /t\('skills\.page\.refresh'\)/);
});
