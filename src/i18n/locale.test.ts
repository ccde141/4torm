import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  readStoredLocale,
  resolveMessage,
  writeStoredLocale,
} from './locale';

test('locale defaults to Chinese and accepts only supported values', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en-US');
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('fr-FR'), DEFAULT_LOCALE);
  assert.equal(normalizeLocale(null), DEFAULT_LOCALE);
});

test('locale storage is isolated from business data', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  writeStoredLocale(storage, 'en-US');
  assert.equal(values.get(LOCALE_STORAGE_KEY), 'en-US');
  assert.equal(readStoredLocale(storage), 'en-US');
});

test('missing English messages fall back to Chinese without hiding the key', () => {
  assert.equal(resolveMessage('en-US', 'nav.console'), 'Console');
  assert.equal(resolveMessage('en-US', 'missing.key'), 'missing.key');
  assert.equal(resolveMessage('zh-CN', 'nav.console'), '控制台');
});

test('messages interpolate named UI values without changing user content', () => {
  assert.equal(resolveMessage('en-US', 'memory.prompt', { agent: '研究员 A' }), 'What should 研究员 A remember?');
  assert.equal(resolveMessage('zh-CN', 'memory.prompt', { agent: 'Alice' }), '想让 Alice 记住什么？');
});

test('chat activity messages translate presentation while preserving tool identifiers', () => {
  assert.equal(resolveMessage('en-US', 'chat.tool.running', { tool: 'write_file' }), 'Running write_file');
  assert.equal(resolveMessage('zh-CN', 'chat.tool.running', { tool: 'write_file' }), '正在执行 write_file');
});
