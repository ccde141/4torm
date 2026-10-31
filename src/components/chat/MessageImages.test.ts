import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import { ImageDrafts, MessageImages } from './MessageImages';

test('human attachment history preserves original links without eagerly mounting original images', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, null, createElement(MessageImages, {
    images: [{ id: 'image-a', name: 'picture.png', mimeType: 'image/png', size: 2048 }],
    agentId: 'agent/a', sessionId: 'session a',
  })));
  assert.match(html, /href="\/api\/conversation\/attachments\/agent%2Fa\/session%20a\/image-a"/);
  assert.match(html, /picture.png/);
  assert.match(html, /查看原图/);
  assert.doesNotMatch(html, /<img|src=|data:image|base64/);
});

test('empty attachment history does not mount a preview collection', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(MessageImages, { images: [], agentId: 'agent-a', sessionId: 'session-a' })));
  assert.equal(html, '');
});

test('pending upload drafts retain their local preview and removal control', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, null, createElement(ImageDrafts, {
    images: [{ key: 'draft-a', name: 'draft.png', mimeType: 'image/png', size: 1,
      dataUrl: 'data:image/png;base64,AA==' }], onRemove() {},
  })));
  assert.match(html, /<img src="data:image\/png;base64,AA=="/);
  assert.match(html, /aria-label="移除 draft.png"/);
  assert.doesNotMatch(html, /\/api\/conversation\/attachments/);
});
