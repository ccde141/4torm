import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import MarkdownText from './MarkdownText';
import BoundedText from './BoundedText';
import { mayRenderMarkdown } from './markdown-budget';
import { messagePageOffsets, needsTextPaging, selectedTextPage } from './text-pages';

const render = (text: string) => renderToStaticMarkup(createElement(LocaleProvider, null,
  createElement(MarkdownText, { text, id: 'display-test' })));

test('normal Markdown, fenced code and ordinary math preserve their formatted output', () => {
  const html = render('## Title\n\n**strong** and [link](https://example.com)\n\n$\\frac{1}{2}$\n\n```js\nconst answer = 42;\n```');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>strong<\/strong>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /class="katex"/);
  assert.match(html, /md-code-block/);
});

test('small dense math cannot expand into the previously reproduced megabyte KaTeX tree', () => {
  const source = '$' + '\\frac{1}{2}'.repeat(1_600) + '$';
  assert.ok(source.length < 32_000);
  const html = render(source);
  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /data-text-page="1"/);
  assert.ok(html.length < 20_000);
});

test('dense tables and deeply nested brackets render as unchanged original text', () => {
  const row = (value: string) => `|${Array(40).fill(value).join('|')}|\n`;
  const table = row('a') + row('-') + row('x').repeat(80);
  const nested = '['.repeat(2_000) + 'x' + ']'.repeat(2_000);
  for (const source of [table, nested]) {
    const html = render(source);
    assert.doesNotMatch(html, /<table|class="md-rendered"/);
    assert.ok(html.includes(source));
  }
});

test('invalid/unclosed inline and fenced code cannot bypass the math expansion budget', () => {
  const math = '$' + '\\frac{1}{2}'.repeat(1_600) + '$';
  for (const prefix of ['`', '```invalid`info\n', '~~~\n```\n~~~\n']) {
    assert.equal(mayRenderMarkdown(prefix + math), false);
  }
  assert.equal(mayRenderMarkdown('```latex\n' + math + '\n```'), true);
  assert.equal(mayRenderMarkdown('$\\def\\a{\\a\\a}\\a$'), false);
});

test('short math cannot request an enormous CSS drawing surface', () => {
  const html = render('$\\rule{10000000em}{10000000em}$');
  assert.match(html, /class="katex"/);
  const dimensions = [...html.matchAll(/(?:style|width|height)="([^"]+)"/g)].map(match => match[1]).join(' ');
  assert.doesNotMatch(dimensions, /10000000em/);
  assert.match(html, /application\/x-tex/);
});

test('dense matrices and nested blockquotes cannot bypass the structural budget', () => {
  const columns = '$$\\begin{matrix}' + 'a&'.repeat(1_000) + 'a\\end{matrix}$$';
  const rows = '$$\\begin{matrix}' + 'a\\\\'.repeat(1_000) + 'a\\end{matrix}$$';
  for (const source of [columns, rows, '> '.repeat(1_000) + 'nested']) {
    const html = render(source);
    assert.doesNotMatch(html, /class="katex"|<blockquote/);
    assert.ok(html.length < 20_000);
  }
  assert.match(render('$$\\begin{matrix}a&b\\\\c&d\\end{matrix}$$'), /class="katex/);
});

test('long sources remain completely addressable, including surrogate pairs and long lines', () => {
  const source = 'a'.repeat(16_383) + '🙂' + 'tail\n'.repeat(20_000);
  const offsets = messagePageOffsets(source, 16_384);
  const pages = offsets.slice(0, -1).map((start, index) => source.slice(start, offsets[index + 1]));
  assert.equal(pages.join(''), source);
  assert.equal(pages[0]?.length, 16_383);
  assert.equal(pages[1]?.startsWith('🙂'), true);
  assert.ok(pages.every(page => page.length <= 16_384));
  assert.equal(messagePageOffsets('x'.repeat(100_000), 16_384).at(-1), 100_000);
});

test('short dense lines are bounded before both Markdown parsing and raw text layout', () => {
  const source = '```txt\n' + 'x\n'.repeat(10_000) + '```';
  assert.equal(mayRenderMarkdown(source), false);
  const offsets = messagePageOffsets(source, 16_384);
  const pages = offsets.slice(0, -1).map((start, index) => source.slice(start, offsets[index + 1]));
  assert.ok(pages.every(page => (page.match(/\n/g)?.length ?? 0) <= 240));
  assert.equal(pages.join(''), source);
  assert.ok(render(source).length < 2_000);
  assert.equal(needsTextPaging('x\n'.repeat(1_000)), true);
  assert.equal(needsTextPaging('ordinary reasoning\n'.repeat(20)), false);
});

test('stream following respects manual page selection and resets for a different text identity', () => {
  assert.equal(selectedTextPage({ id: 'a', page: null }, 'a', 3, true), 3);
  assert.equal(selectedTextPage({ id: 'a', page: 1 }, 'a', 4, true), 1);
  assert.equal(selectedTextPage({ id: 'a', page: 1 }, 'b', 4, true), 4);
  assert.equal(selectedTextPage({ id: 'a', page: null }, 'a', 4, false), 0);
});

test('paged raw text can be rendered within pre without invalid block descendants', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement('pre', null, createElement(BoundedText, { text: 'raw\n'.repeat(10_000), id: 'raw' }))));
  assert.match(html, /data-text-page="1"/);
  assert.doesNotMatch(html, /<div/);
  assert.ok(html.length < 20_000);
});
