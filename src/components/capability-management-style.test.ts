import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('provider and tools share presentation without sharing feature state', async () => {
  const [settings, provider, tools, styles] = await Promise.all([
    readFile(new URL('./layout/SettingsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./layout/ProviderCard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./tools/ToolsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../styles/components/capability-management.css', import.meta.url), 'utf8'),
  ]);

  assert.match(settings, /capability-page/);
  assert.match(settings, /capability-header/);
  assert.match(provider, /capability-panel/);
  assert.match(provider, /capability-button--primary/);
  assert.match(tools, /capability-page/);
  assert.match(tools, /capability-panel/);
  assert.match(tools, /capability-button--primary/);
  assert.match(tools, /capability-button--danger/);
  assert.match(styles, /\.capability-button--primary/);
  assert.match(styles, /\.capability-field/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styles, /provider-|tools-|mcp-|skill-/);
  assert.doesNotMatch(styles, /rgba\(0,\s*0,\s*0,\s*0\.75\)/);
  assert.doesNotMatch(styles, /fetch\(|updateProvider|saveTools/);
});
