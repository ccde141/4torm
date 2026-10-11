import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../../i18n/LocaleContext';
import { Toolbar } from './Toolbar';

test('external execution identifies its workflow next to the current editor', () => {
  const noop = () => {};
  const markup = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(Toolbar, {
      workflowId: 'W1', workflowName: 'Local draft', activeWorkflowId: 'W2',
      running: true, phase: 'running', saveTime: null,
      onRun: noop, onOpenProfiles: noop, onStop: noop, onSave: noop,
      onOpenWorkspace: noop, onSetWorkflowName: noop, onLoadList: noop,
    }),
  ));
  assert.match(markup, /Local draft/);
  assert.match(markup, /W1/);
  assert.match(markup, /W2/);
  assert.match(markup, /运行中：W2|Running: W2/);
});
