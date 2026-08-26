import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('skills reuse capability management visuals while keeping preview styles local', async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL('./SkillsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../styles/components/skills.css', import.meta.url), 'utf8'),
  ]);

  assert.match(page, /capability-page/);
  assert.match(page, /capability-header/);
  assert.match(page, /capability-panel capability-record/);
  assert.match(page, /capability-button--primary/);
  assert.match(page, /capability-button--danger/);
  assert.match(page, /capability-alert/);
  assert.match(page, /capability-form/);
  assert.match(styles, /\.skill-preview-overlay/);
  assert.match(styles, /\.skill-preview-modal/);
  assert.doesNotMatch(styles, /\.skill-card\s*\{[^}]*background:/s);
  assert.doesNotMatch(styles, /\.skill-btn-preview\s*\{[^}]*background:/s);
});
