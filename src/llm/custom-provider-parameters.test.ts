import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineCustomParameter,
  readCustomParameterDefinitions,
  removeCustomParameter,
  setCustomParameterFromText,
} from './custom-provider-parameters.js';

test('custom parameter definitions reject protected, unsafe and conflicting paths', () => {
  assert.throws(() => defineCustomParameter([], {
    path: 'messages', label: 'Messages', kind: 'json',
  }), /核心字段.*messages/);
  assert.throws(() => defineCustomParameter([], {
    path: 'chat_template_kwargs.__proto__.mode', label: 'Mode', kind: 'string',
  }), /不安全字段/);
  const existing = [defineCustomParameter([], {
    path: 'reasoning.effort', label: 'Effort', kind: 'string',
  })];
  assert.throws(() => defineCustomParameter(existing, {
    path: 'reasoning', label: 'Reasoning', kind: 'json',
  }), /路径冲突/);
  assert.throws(() => defineCustomParameter(existing, {
    path: 'reasoning.effort', label: 'Duplicate', kind: 'string',
  }), /已存在/);
});

test('typed custom parameter values preserve number, boolean, select and JSON types', () => {
  const number = defineCustomParameter([], { path: 'top_k', label: 'Top K', kind: 'number' });
  const bool = defineCustomParameter([], { path: 'cache_prompt', label: 'Cache', kind: 'boolean' });
  const select = defineCustomParameter([], {
    path: 'reasoning_effort', label: 'Effort', kind: 'select', options: ['low', 'high'],
  });
  const json = defineCustomParameter([], {
    path: 'chat_template_kwargs', label: 'Template', kind: 'json',
  });
  let values = setCustomParameterFromText({}, number, '12');
  values = setCustomParameterFromText(values, bool, 'true');
  values = setCustomParameterFromText(values, select, 'high');
  values = setCustomParameterFromText(values, json, '{"enable_thinking":true}');
  assert.deepEqual(values, {
    top_k: 12,
    cache_prompt: true,
    reasoning_effort: 'high',
    chat_template_kwargs: { enable_thinking: true },
  });
  assert.throws(() => setCustomParameterFromText(values, number, 'NaN'), /有限数字/);
  assert.throws(() => setCustomParameterFromText(values, select, 'medium'), /可选值/);
});

test('nested values are immutable and deleting a definition prunes empty parents', () => {
  const definition = defineCustomParameter([], {
    path: 'chat_template_kwargs.mode', label: 'Mode', kind: 'string',
  });
  const source = { existing: true };
  const set = setCustomParameterFromText(source, definition, 'fast');
  assert.deepEqual(source, { existing: true });
  assert.deepEqual(set, { existing: true, chat_template_kwargs: { mode: 'fast' } });
  assert.deepEqual(removeCustomParameter(set, definition.path), { existing: true });
});

test('malformed hand-edited definitions are reported without breaking valid fields', () => {
  const result = readCustomParameterDefinitions([
    { id: 'valid', path: 'top_k', label: 'Top K', kind: 'number' },
    { id: 'unsafe', path: 'messages', label: 'Messages', kind: 'json' },
    { id: 'bad-kind', path: 'mode', label: 'Mode', kind: 'mystery' },
    null,
  ]);
  assert.deepEqual(result.definitions, [
    { id: 'valid', path: 'top_k', label: 'Top K', kind: 'number' },
  ]);
  assert.equal(result.invalidCount, 3);
});
