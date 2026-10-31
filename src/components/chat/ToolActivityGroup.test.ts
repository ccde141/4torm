import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import ToolActivityList, { type ToolActivityItem } from './ToolActivityGroup';

function render(items: ToolActivityItem[]) {
  const mounted: string[] = [];
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(ToolActivityList, {
      items,
      renderItem: item => {
        mounted.push(item.tool);
        return createElement('span', { key: item.tool }, item.tool);
      },
    })));
  return { mounted, html };
}

test('collapsed ordinary group keeps summary but does not mount tool cards', () => {
  const result = render([
    { tool: 'read_file', status: 'done' },
    { tool: 'write_file', status: 'done' },
    { tool: 'run_command', status: 'running' },
  ]);
  assert.deepEqual(result.mounted, []);
  assert.match(result.html, /tool-activity-group__summary/);
  assert.match(result.html, /正在执行 run_command/);
  assert.match(result.html, /thinking-card__tool-spinner/);
});

test('failed ordinary group remains open with every tool card mounted', () => {
  const result = render([
    { tool: 'read_file', status: 'error' },
    { tool: 'write_file', status: 'done' },
  ]);
  assert.deepEqual(result.mounted, ['read_file', 'write_file']);
  assert.match(result.html, /<details[^>]* open=""/);
  assert.match(result.html, /1 项失败/);
});

test('large failed group starts folded while its failure count stays visible', () => {
  const items = Array.from({ length: 21 }, (_, index) => ({
    tool: `ordinary_${index}`, status: index === 0 ? 'error' : 'done',
  }));
  const small = render(items.slice(0, 20));
  assert.equal(small.mounted.length, 20);
  assert.match(small.html, /<details[^>]* open=""/);

  const large = render(items);
  assert.deepEqual(large.mounted, []);
  assert.doesNotMatch(large.html, /<details[^>]* open=/);
  assert.match(large.html, /21 项工具操作/);
  assert.match(large.html, /1 项失败/);
});

test('framework tools and solitary ordinary tools remain immediately visible', () => {
  const result = render([
    { tool: 'read_file', status: 'done' },
    { tool: 'ask', status: 'done' },
    { tool: 'write_file', status: 'done' },
  ]);
  assert.deepEqual(result.mounted, ['read_file', 'ask', 'write_file']);
});

test('large legacy tool lists keep their original absolute indexes in the bounded latest window', () => {
  const indexes: number[] = [];
  const items = Array.from({ length: 241 }, (_, index) => ({ tool: `team_fixture_${index}`, status: 'done' }));
  const original = structuredClone(items);
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(ToolActivityList, { items, renderItem: (item, index) => {
      indexes.push(index);
      return createElement('span', { key: item.tool }, item.tool);
    } })));
  assert.equal(indexes.length, 80);
  assert.equal(indexes[0], 161);
  assert.equal(indexes.at(-1), 240);
  assert.match(html, /上一段/);
  assert.match(html, /team_fixture_240/);
  assert.doesNotMatch(html, /team_fixture_0</);
  assert.deepEqual(items, original);
});

test('a single visible tool keeps its original multi-tool group at a display window edge', () => {
  const items = [{ tool: 'read_file', status: 'done' }, { tool: 'write_file', status: 'done' },
    ...Array.from({ length: 79 }, (_, index) => ({ tool: `team_fixture_${index}`, status: 'done' }))];
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(ToolActivityList, { items, renderItem: (item, index) => createElement('span', { key: index }, item.tool) })));
  assert.match(html, /tool-activity-group__summary/);
  assert.match(html, /1 项工具操作/);
  assert.doesNotMatch(html, /<span>write_file<\/span>/);
});
