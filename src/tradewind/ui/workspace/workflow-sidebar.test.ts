import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../../i18n/LocaleContext';
import { WorkflowSidebar, type WorkflowSidebarProps } from './WorkflowSidebar';

const items = ['A', 'B'].map(name => ({ workflowId: name, name, nodeCount: 3,
  revision: 'r1', updatedAt: '2026-10-16T00:00:00Z', workflowType: 'strict' as const }));
function render(overrides: Partial<WorkflowSidebarProps> = {}) {
  return renderToStaticMarkup(createElement(LocaleProvider, null, createElement(WorkflowSidebar, {
    items, selectedId: 'A', selectedType: 'strict', onSelect() {}, onTypeChange() {}, onCreate() {},
    onDelete: async () => {}, onRefresh() {}, ...overrides,
  })));
}
const body = (html: string) => html.slice(html.indexOf('class="tw-workflow-sidebar__body"'));

test('switching or refreshing an existing list keeps status outside the card flow', () => {
  const html = render({ loading: true });
  assert.match(html, /role="status"/);
  assert.match(body(html), /aria-busy="true"/);
  assert.doesNotMatch(body(html), /role="status"/);
  for (const loading of [false, true]) assert.deepEqual(
    [...render({ loading, selectedId: loading ? 'B' : 'A' }).matchAll(/<strong title="([^"]+)"/g)].map(match => match[1]), ['A', 'B']);
});

test('the first empty load still explains that workflows are loading', () => {
  const html = body(render({ items: [], loading: true }));
  assert.match(html, /role="status"/);
  assert.match(html, /正在读取工作流/);
  assert.doesNotMatch(html, /还没有工作流/);
});

test('a failed refresh keeps the existing list and exposes the real error', () => {
  const html = body(render({ error: '读取失败' }));
  assert.match(html, /role="alert"[^>]*>读取失败/);
  assert.match(html, /<strong title="A"/);
});

test('selected cards retain their runtime state and selection alone does not confirm completion', () => {
  const runtimeItems = [
    { ...items[0], status: 'completed' as const, runId: 'run-a' },
    { ...items[1], status: 'running' as const, runId: 'run-b' },
  ];
  const html = render({ items: runtimeItems, selectedId: 'A' });
  assert.match(html, /data-state="completed" class="tw-workflow-card is-active"/);
  assert.match(html, /data-state="running" class="tw-workflow-card"/);
});
