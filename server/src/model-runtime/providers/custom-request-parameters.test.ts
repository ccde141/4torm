import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCustomRequestParameters } from './custom-request-parameters.js';

test('custom request parameters override adapter defaults and merge nested objects', () => {
  const source = {
    model: 'qwen', messages: [], stream: true, max_tokens: 2048,
    chat_template_kwargs: { enable_thinking: true, existing: 'kept' },
  };
  const merged = mergeCustomRequestParameters(source, {
    max_tokens: 4096,
    reasoning_effort: 'high',
    chat_template_kwargs: { reasoning_effort: 'high' },
  });
  assert.deepEqual(merged, {
    model: 'qwen', messages: [], stream: true, max_tokens: 4096,
    reasoning_effort: 'high',
    chat_template_kwargs: {
      enable_thinking: true, existing: 'kept', reasoning_effort: 'high',
    },
  });
  assert.equal(source.max_tokens, 2048);
  assert.deepEqual(source.chat_template_kwargs, { enable_thinking: true, existing: 'kept' });
});

test('custom request parameters cannot override framework protocol fields', () => {
  for (const key of ['model', 'messages', 'system', 'stream', 'tools', 'tool_choice']) {
    assert.throws(
      () => mergeCustomRequestParameters({ model: 'safe' }, { [key]: 'unsafe' }),
      new RegExp(`不能覆盖核心字段.*${key}`),
    );
  }
});

test('custom request parameters reject unsafe paths and non-JSON values', () => {
  const polluted = JSON.parse('{"chat_template_kwargs":{"__proto__":{"polluted":true}}}');
  assert.throws(() => mergeCustomRequestParameters({}, polluted), /不安全字段.*__proto__/);
  assert.throws(() => mergeCustomRequestParameters({}, { value: Number.NaN }), /有限数字/);
  assert.throws(() => mergeCustomRequestParameters({}, []), /必须是对象/);
});

test('missing custom request parameters preserve the normalized request', () => {
  const source = { model: 'qwen', messages: [] };
  assert.deepEqual(mergeCustomRequestParameters(source, undefined), source);
  assert.notEqual(mergeCustomRequestParameters(source, undefined), source);
});
