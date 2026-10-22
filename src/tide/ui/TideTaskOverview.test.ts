import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TideRunState, TideTask } from '../../api/tide';
import { LocaleProvider } from '../../i18n/LocaleContext';
import TideTaskOverview from './TideTaskOverview';

const task: TideTask = { id: 'tide-overview', name: '资料汇总', agentId: 'agent-fixture',
  prompt: '汇总资料', schedule: 'daily 08:00', enabled: false, repeatCount: -1, pushMode: 'accumulate',
  windowN: 1, selfLoop: false, consecutiveErrors: 0, createdAt: '2026-10-01T00:00:00Z',
  nextRun: '2026-10-23T00:00:00Z' };

function render(overrides: Partial<TideTask> = {}, runState: TideRunState | null = null, running = false) {
  return renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TideTaskOverview, { task: { ...task, ...overrides }, agentName: '资料研究员', runState, running })));
}

test('暂停及执行结束的概览不把残留下次触发时间当作有效计划', () => {
  for (const overrides of [{}, { enabled: true, repeatCount: 0 }]) {
    const html = render(overrides);
    assert.match(html, /资料研究员/);
    assert.match(html, /agent-fixture/);
    assert.match(html, /每天 08:00/);
    assert.match(html, /潮汐独立会话 · 保留 1 轮/);
    assert.doesNotMatch(html, /2026-10-23|2026\/10\/23/);
  }
});

test('手动执行状态与暂停的触发计划分别呈现，失败保留错误状态', () => {
  const active = render({}, null, true);
  assert.match(active, /data-state="running"/);
  assert.match(active, /执行中/);
  assert.match(active, /已暂停/);
  const failed = render({}, { runId: 'run-failed', status: 'failed' });
  assert.match(failed, /data-state="failed"/);
  assert.match(failed, /失败/);
});
