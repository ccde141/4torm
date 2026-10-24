import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleContext } from '../../i18n/locale-context';
import { resolveMessage, type Locale } from '../../i18n/locale';

registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
const { default: ReasoningBlock } = await import('./ReasoningBlock');

function render(options: Partial<ComponentProps<typeof ReasoningBlock>>, locale: Locale = 'zh-CN') {
  return renderToStaticMarkup(createElement(LocaleContext.Provider,
    { value: { locale, setLocale: () => {}, t: (key, values) => resolveMessage(locale, key, values) } },
    createElement(ReasoningBlock, { reasoning: '先核对输入，再核对结果。', isStreaming: false, ...options })));
}

test('reasoning preview remains visible after completion and offers a height control', () => {
  const html = render({ preview: true, defaultOpen: false });
  assert.match(html, /先核对输入，再核对结果。/);
  assert.match(html, /reasoning-block__preview-body/);
  assert.match(html, /class="reasoning-block__header"[^>]*aria-expanded="true"/);
  assert.match(html, /class="reasoning-block__height-control"[^>]*aria-pressed="false"[^>]*>完整高度<\/button>/);
  assert.match(html, /<\/button><button[^>]*class="reasoning-block__height-control"/);
  assert.match(html, /reasoning-block__icon/);
  assert.match(html, /role="region"/);
  assert.doesNotMatch(html, /reasoning-block__spinner/);
});

test('streaming preview stays visible without starting in unrestricted height', () => {
  const html = render({ preview: true, isStreaming: true });
  assert.match(html, /先核对输入，再核对结果。/);
  assert.match(html, /class="reasoning-block__header"[^>]*aria-expanded="true"/);
  assert.match(html, /class="reasoning-block__height-control"[^>]*aria-pressed="false"/);
  assert.match(html, /reasoning-block__spinner/);
  assert.doesNotMatch(html, /reasoning-block__preview-body is-expanded/);
});

test('preview keeps reasoning phase separators and follows the selected language', () => {
  const html = render({ preview: true, reasoning: 'First phaseSecond phase', breaks: [11] }, 'en-US');
  assert.match(html, /First phase/);
  assert.match(html, /Second phase/);
  assert.match(html, /turn-process-reasoning-divider/);
  assert.match(html, /Full height/);
  assert.doesNotMatch(html, /完整高度/);
});

test('ordinary reasoning blocks retain their existing collapse defaults', () => {
  const completed = render({});
  assert.doesNotMatch(completed, /先核对输入，再核对结果。|reasoning-block__preview-body/);
  assert.match(completed, /aria-expanded="false"/);
  const streaming = render({ isStreaming: true });
  assert.match(streaming, /先核对输入，再核对结果。/);
  assert.match(streaming, /aria-expanded="true"/);
  assert.doesNotMatch(streaming, /reasoning-block__preview-body|完整高度/);
});
