import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('provider controls have visible hierarchy and button affordances', async () => {
  const [page, card, capabilities, controls, workspace, shared] = await Promise.all([
    readFile(new URL('./SettingsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderCard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ModelCapabilityPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderControls.css', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderWorkspace.css', import.meta.url), 'utf8'),
    readFile(new URL('../../styles/components/capability-management.css', import.meta.url), 'utf8'),
  ]);
  const source = `${card}\n${capabilities}`;
  const css = `${controls}\n${workspace}\n${shared}`;

  assert.match(page, /ProviderControls\.css/);
  assert.match(source, /capability-button--primary/);
  assert.match(source, /capability-button--secondary/);
  assert.match(source, /provider-probe-action/);
  assert.match(source, /provider-remove-model/);
  assert.match(source, /provider-danger-action/);
  assert.match(css, /\.capability-panel\s*\{/);
  assert.match(css, /linear-gradient/);
  assert.match(css, /\.capability-panel\s*\{[^}]*background:\s*var\(--color-surface\)/s);
  assert.match(css, /\.provider-navigator\s*\{[^}]*background:\s*var\(--color-surface\)/s);
  assert.match(css, /\.capability-button--primary\s*\{[^}]*background:\s*var\(--color-accent-subtle\)/s);
  assert.match(css, /\.capability-button--secondary[^}]*background:\s*color-mix\(in srgb, var\(--glass-bg-strong\)/s);
  assert.match(css, /\.capability-panel\s*\{[^}]*var\(--glass-border\)/s);
  assert.match(css, /\.capability-button--secondary/);
  assert.match(css, /\.provider-probe-action/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*3[2-9]px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /className="provider-type-select"/);
  assert.match(css, /\.provider-type-select option\s*\{[^}]*background:\s*var\(--color-bg-secondary\)[^}]*color:\s*var\(--color-text-primary\)/s);
  assert.match(css, /\.provider-type-select option:disabled\s*\{[^}]*color:\s*var\(--color-text-secondary\)/s);
  assert.doesNotMatch(css, /\.provider-detail-card::before/);
  assert.doesNotMatch(css, /\.provider-schema-toggle:hover > span:last-child\s*\{[^}]*transform:/s);
  assert.doesNotMatch(controls, /color-mix\(in srgb, white|inset 0 1px color-mix\(in srgb, white/);
});
