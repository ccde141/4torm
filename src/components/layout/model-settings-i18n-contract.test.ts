import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('model settings localizes UI without changing provider configuration values', async () => {
  const files = await Promise.all([
    readFile(new URL('./SettingsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderCard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ModelCapabilityPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ModelProfileSelect.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderConfigurationForm.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderCustomParametersForm.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./ProviderNavigator.tsx', import.meta.url), 'utf8'),
  ]);
  const source = files.join('\n');

  assert.match(source, /useLocale/);
  assert.match(source, /model\.settings\.title/);
  assert.match(source, /model\.provider\.type/);
  assert.match(source, /model\.provider\.configuration/);
  assert.match(source, /configuration\.sections/);
  assert.match(source, /parseConfigurationInput/);
  assert.match(source, /validateConfigurationConstraints/);
  assert.match(source, /providerSelectionPatch\(catalog, preset\.providerType\)/);
  assert.match(source, /selectedProvider/);
  assert.match(source, /key=\{selectedProvider\.id\}/);
  assert.match(source, /model-provider-workspace/);
  assert.match(source, /SchemaDisclosure/);
  assert.match(source, /provider-detail-header/);
  assert.match(source, /provider-detail-divider/);
  assert.match(source, /model\.provider\.schemaToggle/);
  assert.doesNotMatch(source, /model\.provider\.customUnverified/);
  assert.match(source, /customParameterDefinitions/);
  assert.match(source, /customRequestParameters/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /provider-section-card/);
  assert.doesNotMatch(source, /model\.provider\.headers/);
  assert.doesNotMatch(source, /headersJson/);
  assert.doesNotMatch(source, /model\.provider\.advanced/);
  assert.doesNotMatch(source, /AdvancedFields/);
  assert.doesNotMatch(source, /showAdvanced/);
  assert.match(source, /model\.capability\.title/);
  assert.match(source, /model\.profile\.label/);
  assert.match(source, /preset\.label/);
  assert.doesNotMatch(files[0]!, /addCustom/);
  assert.doesNotMatch(files[0]!, /onCustom/);
  assert.doesNotMatch(files[0]!, /customLabel/);
  assert.match(source, /p\.baseUrl/);
  assert.match(source, /p\.apiKey/);
});

test('capability probes do not inject custom chat request parameters', async () => {
  const source = await readFile(new URL('../../llm/config.ts', import.meta.url), 'utf8');
  const toolProbe = source.slice(
    source.indexOf('export async function probeAndStore'),
    source.indexOf('export async function probeVisionAndStore'),
  );
  const visionProbe = source.slice(
    source.indexOf('export async function probeVisionAndStore'),
    source.indexOf('export async function getModelCapability'),
  );
  assert.doesNotMatch(toolProbe, /customRequestParameters/);
  assert.doesNotMatch(visionProbe, /customRequestParameters/);
});
