import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('语言模块更新后，旧 Provider 与新消费者仍共享同一上下文', async () => {
  const before = await import('./LocaleContext.tsx?revision=before');
  const after = await import('./LocaleContext.tsx?revision=after');
  assert.notEqual(before.LocaleProvider, after.LocaleProvider);
  function Consumer() { return createElement('span', null, after.useLocale().locale); }
  const html = renderToStaticMarkup(createElement(before.LocaleProvider, null,
    createElement(Consumer)));
  assert.match(html, /<span>(zh-CN|en-US)<\/span>/);
});
