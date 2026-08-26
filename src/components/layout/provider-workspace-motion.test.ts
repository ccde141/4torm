import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('provider workspace uses scoped motion with a reduced-motion fallback', async () => {
  const [css, card, navigator, capabilities] = await Promise.all([
    readFile(new URL('./ProviderWorkspace.css', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderCard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderNavigator.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ModelCapabilityPanel.tsx', import.meta.url), 'utf8'),
  ]);
  const source = `${card}\n${navigator}\n${capabilities}`;

  assert.match(source, /provider-detail-enter/);
  assert.match(source, /provider-model-picker/);
  assert.match(source, /provider-model-tag/);
  assert.match(source, /provider-capability-row/);
  assert.match(source, /provider-probe-dot/);
  assert.match(css, /@keyframes provider-detail-enter/);
  assert.match(css, /@keyframes provider-schema-reveal/);
  assert.match(css, /@keyframes provider-item-rise/);
  assert.match(css, /@keyframes provider-probe-pulse/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /--motion-enter-duration/);
  assert.doesNotMatch(source, /setTimeout\([^)]*animation/);
});
