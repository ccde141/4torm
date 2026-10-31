import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import ToolResultImages from './ToolResultImages';
import ToolImageViewer from './ToolImageViewer';

test('unobserved tool images keep their original link without decoding image bytes', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, null, createElement(ToolResultImages, {
    images: [{ id: 'image-a', name: 'screen.png', mimeType: 'image/png', size: 2048 }],
    scope: { feature: 'monsoon', agentId: 'agent-a', sessionId: 'session-a' },
  })));
  assert.match(html, /href="\/api\/tool-media\/monsoon\/image-a\?agentId=agent-a&amp;sessionId=session-a"/);
  assert.doesNotMatch(html, /<img|src=/);
  assert.match(html, /screen.png/);
  assert.doesNotMatch(html, /data:image|base64|desktop_observe|desktop_act/);
});

test('the original image viewer retains an explicit link before visibility activates its image', () => {
  const source = '/api/tool-media/monsoon/image-a?agentId=agent-a&sessionId=session-a';
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(ToolImageViewer, { source, name: 'screen.png', onClose() {} })));
  assert.match(html, /<dialog/);
  assert.match(html, /href="\/api\/tool-media\/monsoon\/image-a\?agentId=agent-a&amp;sessionId=session-a"/);
  assert.match(html, /在新标签页打开/);
  assert.match(html, /正在加载原图/);
  assert.doesNotMatch(html, /<img|preview=1|data:image|base64/);
});
