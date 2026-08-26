import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configurationPatch,
  configurationValue,
  parseConfigurationInput,
  validateConfigurationConstraints,
} from './provider-configuration.js';
import type { ProviderConfigurationField, ProviderConfigurationSchema } from './provider-catalog.js';

const field: ProviderConfigurationField = {
  path: 'generationDefaults.topP',
  label: { zh: 'Top P', en: 'Top P' },
  description: { zh: '采样', en: 'Sampling' },
  kind: 'number', nullable: true, min: 0, max: 1, step: 0.01,
};

const selectField: ProviderConfigurationField = {
  path: 'generationDefaults.thinkingMode',
  label: { zh: '思考模式', en: 'Thinking mode' },
  description: { zh: '控制思考', en: 'Controls thinking' },
  kind: 'select', nullable: false,
  options: [
    { value: 'auto', label: { zh: '自动', en: 'Auto' } },
    { value: 'enabled', label: { zh: '开启', en: 'Enabled' } },
    { value: 'disabled', label: { zh: '关闭', en: 'Disabled' } },
  ],
};

test('configuration reads persisted values before catalog defaults', () => {
  const defaults = { generationDefaults: { topP: null } };
  assert.equal(configurationValue({ generationDefaults: { topP: 0.8 } }, defaults, field.path), 0.8);
  assert.equal(configurationValue({}, defaults, field.path), null);
});

test('configuration input reports empty integer and numeric range errors', () => {
  assert.deepEqual(parseConfigurationInput('', field, 'zh'), { value: null });
  assert.deepEqual(parseConfigurationInput('1.5', field, 'en'), { error: 'Top P must be between 0 and 1.' });
  assert.deepEqual(parseConfigurationInput('abc', field, 'zh'), { error: 'Top P 必须是数字。' });
  assert.deepEqual(parseConfigurationInput('0.75', field, 'zh'), { value: 0.75 });
});

test('configuration select accepts catalog values and rejects unknown values', () => {
  assert.deepEqual(parseConfigurationInput('enabled', selectField, 'zh'), { value: 'enabled' });
  assert.deepEqual(parseConfigurationInput('other', selectField, 'en'), {
    error: 'Thinking mode has an invalid option.',
  });
  assert.equal(configurationValue({
    generationDefaults: { thinkingMode: 'disabled' },
  }, { generationDefaults: { thinkingMode: 'auto' } }, selectField.path), 'disabled');
});

test('configuration patches one section without mutating sibling values', () => {
  const provider = {
    generationDefaults: { maxOutputTokens: 2048, topP: null },
    runtimePolicy: { contextWindowTokens: null },
  };
  assert.deepEqual(configurationPatch(provider, field.path, 0.9), {
    generationDefaults: { maxOutputTokens: 2048, topP: 0.9 },
  });
  assert.equal(provider.generationDefaults.topP, null);
});

test('cross-field constraints return catalog-owned localized guidance', () => {
  const schema: ProviderConfigurationSchema = {
    defaults: {
      runtimePolicy: { contextWindowTokens: null },
      generationDefaults: { maxOutputTokens: 2048 },
    },
    sections: [],
    constraints: [{
      kind: 'less-than', valuePath: 'generationDefaults.maxOutputTokens',
      limitPath: 'runtimePolicy.contextWindowTokens',
      message: { zh: '输出必须更小。', en: 'Output must be lower.' },
    }],
  };
  assert.equal(validateConfigurationConstraints({
    runtimePolicy: { contextWindowTokens: 1024 },
    generationDefaults: { maxOutputTokens: 2048 },
  }, schema, 'zh'), '输出必须更小。');
  assert.equal(validateConfigurationConstraints({
    runtimePolicy: { contextWindowTokens: null },
    generationDefaults: { maxOutputTokens: 2048 },
  }, schema, 'en'), undefined);
});
