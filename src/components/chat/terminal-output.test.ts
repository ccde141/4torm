import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import TerminalOutputRows from './TerminalOutputRows';
import { renderTerminalLines, renderTerminalOutput } from './terminal-output';

test('terminal output keeps only the latest carriage-return progress line', () => {
  assert.equal(renderTerminalOutput([
    { stream: 'stdout', text: 'Downloading 10%\r' },
    { stream: 'stdout', text: 'Downloading 100%\nDone\n' },
  ]), 'Downloading 100%\nDone\n');
});

test('terminal output preserves the order of stdout and stderr chunks', () => {
  assert.equal(renderTerminalOutput([
    { stream: 'stdout', text: 'Installing\n' },
    { stream: 'stderr', text: 'warning: optional dependency\n' },
  ]), 'Installing\nwarning: optional dependency\n');
});

test('terminal lines retain stderr provenance in the shared output timeline', () => {
  assert.deepEqual(renderTerminalLines([
    { stream: 'stdout', text: 'Installing\n' },
    { stream: 'stderr', text: 'error: package failed\n' },
  ]), [
    { stream: 'stdout', text: 'Installing' },
    { stream: 'stderr', text: 'error: package failed' },
  ]);
});

test('long terminal logs mount one page and retain the newest stderr evidence', () => {
  const chunks = [{ stream: 'stdout' as const, text: 'line\n'.repeat(5_000) },
    { stream: 'stderr' as const, text: 'last diagnostic\n' }];
  const original = JSON.stringify(chunks);
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TerminalOutputRows, { chunks })));
  assert.ok((html.match(/<div/g) ?? []).length <= 400);
  assert.match(html, /last diagnostic/);
  assert.match(html, /#eeaaa1/);
  assert.match(html, /<nav/);
  assert.equal(JSON.stringify(chunks), original);
});
