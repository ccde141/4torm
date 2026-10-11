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
