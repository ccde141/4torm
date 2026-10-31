import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleContext } from '../../i18n/locale-context';
import { resolveMessage, type Locale } from '../../i18n/locale';
import ToolImageViewer from './ToolImageViewer';

function render(locale: Locale) {
  return renderToStaticMarkup(createElement(LocaleContext.Provider, { value: {
    locale, setLocale() {}, t: (key, values) => resolveMessage(locale, key, values),
  } }, createElement(ToolImageViewer, { source: '/api/tool-media/monsoon/synthetic?sessionId=synthetic',
    name: 'Synthetic image.png', onClose() {} })));
}

test('the original image dialog has localized icon controls and retains a clean on-demand image stage', () => {
  for (const [locale, actions, close, original] of [
    ['zh-CN', '图片操作', '关闭图片', '原图'], ['en-US', 'Image actions', 'Close image', 'Original image'],
  ] as const) {
    const html = render(locale);
    assert.match(html, /<dialog[^>]+class="tool-image-viewer"[^>]+tabindex="-1"/);
    assert.ok(html.includes(`aria-label="${actions}"`));
    assert.ok(html.includes(`aria-label="${close}"`));
    assert.ok(html.includes(original));
    assert.match(html, /tool-image-viewer__stage/);
    assert.match(html, /<svg[^>]+aria-hidden="true"/);
    assert.match(html, /href="\/api\/tool-media\/monsoon\/synthetic\?sessionId=synthetic"/);
    assert.doesNotMatch(html, /<img|data:image|base64|background:#|style=/);
  }
});
