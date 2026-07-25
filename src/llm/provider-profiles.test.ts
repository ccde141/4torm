import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROVIDER_PROFILE_OPTIONS,
  retainModelProfiles,
  setModelProfile,
} from './provider-profiles.js';

test('model profile selection removes auto entries instead of saving blanks', () => {
  const selected = setModelProfile({}, 'qwen3', 'siliconflow-thinking');
  assert.deepEqual(selected, { qwen3: 'siliconflow-thinking' });
  assert.deepEqual(setModelProfile(selected, 'qwen3', 'auto'), {});
});

test('removed models cannot leave stale provider profiles', () => {
  assert.deepEqual(retainModelProfiles({ qwen3: 'siliconflow-thinking', old: 'deepseek' }, ['qwen3']), {
    qwen3: 'siliconflow-thinking',
  });
});

test('automatic profile uses a compact model-row label', () => {
  const automatic = PROVIDER_PROFILE_OPTIONS.find(option => option.value === 'auto');
  assert.equal(automatic?.label, '自动');
});
