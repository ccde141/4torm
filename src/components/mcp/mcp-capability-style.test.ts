import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('mcp reuses capability visuals without changing connection state markup', async () => {
  const [page, form, importer, editors, pageCss, formCss] = await Promise.all([
    readFile(new URL('./McpPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./McpServerForm.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./McpImportPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./McpFieldEditors.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./McpPage.css', import.meta.url), 'utf8'),
    readFile(new URL('./McpForm.css', import.meta.url), 'utf8'),
  ]);
  const controls = `${page}\n${form}\n${importer}\n${editors}`;

  assert.match(page, /capability-page/);
  assert.match(page, /capability-header/);
  assert.match(page, /capability-panel capability-record/);
  assert.match(page, /capability-badge/);
  assert.match(page, /capability-alert/);
  assert.match(controls, /capability-button--primary/);
  assert.match(controls, /capability-button--secondary/);
  assert.match(controls, /capability-button--danger/);
  assert.match(form, /capability-form/);
  assert.match(pageCss, /\.mcp-toggle/);
  assert.match(pageCss, /\.mcp-card__dot--pending/);
  assert.doesNotMatch(pageCss, /\.mcp-btn--primary\s*\{/);
  assert.doesNotMatch(pageCss, /rgba\(0,\s*0,\s*0,\s*0\.75\)/);
  assert.doesNotMatch(formCss, /\.mcp-add-form\s*\{[^}]*background:/s);
  assert.match(page, /busy\[server\.name\]/);
  assert.match(page, /server\.connected/);
  assert.match(page, /server\.enabled/);
});
