import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('skills page localizes chrome without translating persisted skill data', () => {
  const source = fs.readFileSync('src/components/skills/SkillsPage.tsx', 'utf8');
  assert.match(source, /useLocale/);
  assert.match(source, /skills\.page\.title/);
  assert.match(source, /skills\.create\.required/);
  assert.match(source, /skills\.preview\.tools/);
  assert.match(source, /\{skill\.name\}/);
  assert.match(source, /skill\.category/);
  assert.match(source, /\{skill\.description\}/);
  assert.match(source, /\{preview\.content\}/);
  assert.match(source, /name: newName\.trim\(\)/);
  assert.match(source, /category: newCategory/);
  assert.match(source, /createSkill\(meta\.id, meta, newContent\)/);
});

test('skill categories accept existing and custom names without translating stored values', () => {
  const source = fs.readFileSync('src/components/skills/SkillsPage.tsx', 'utf8');
  assert.match(source, /list="skill-category-options"/);
  assert.match(source, /value=\{newCategory\}/);
  assert.match(source, /changeSkillCategory\(skill, category\)/);
});
