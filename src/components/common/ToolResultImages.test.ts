import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import ToolResultImages from './ToolResultImages';

test('tool screenshot preview and original link use the same owning scope without executing a tool', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, null, createElement(ToolResultImages, {
    images: [{ id: 'image-a', name: 'screen.png', mimeType: 'image/png', size: 2048 }],
    scope: { feature: 'monsoon', agentId: 'agent-a', sessionId: 'session-a' },
  })));
  assert.match(html, /href="\/api\/tool-media\/monsoon\/image-a\?agentId=agent-a&amp;sessionId=session-a"/);
  assert.match(html, /src="\/api\/tool-media\/monsoon\/image-a\?agentId=agent-a&amp;sessionId=session-a"/);
  assert.match(html, /alt="screen.png"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /crossorigin="use-credentials"/i);
  assert.doesNotMatch(html, /data:image|base64|desktop_observe|desktop_act/);
});
