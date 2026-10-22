import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleContext } from '../../i18n/locale-context';
import { resolveMessage, type Locale } from '../../i18n/locale';
import { SYSTEM_STATUSES } from '../../store/statuses';
import type { Agent } from '../../types';
import { projectAgentActivity, type AgentActivityView } from './dashboard-activity';
import { DashboardStatusFilters, DashboardStatusSummary } from './DashboardStatusControls';

// Card styles have no server-rendering behavior.
registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
const { default: AgentCard } = await import('./AgentCard');

function render(locale: Locale, node: ReactNode) {
  return renderToStaticMarkup(createElement(LocaleContext.Provider,
    { value: { locale, setLocale: () => {}, t: (key, values) => resolveMessage(locale, key, values) } }, node));
}

test('控制台汇总按语言显示智能体、空闲和会话，保留原数量', () => {
  const summary = createElement(DashboardStatusSummary, { totalAgents: 6, idleAgents: 4, totalSessions: 12 });
  const zh = render('zh-CN', summary);
  assert.match(zh, />6<\/span><span>智能体<\/span>/);
  assert.match(zh, />4<\/span><span>空闲<\/span>/);
  assert.match(zh, />12<\/span><span>会话<\/span>/);
  assert.doesNotMatch(zh, /已确认|Agent|Sessions/);
  const en = render('en-US', summary);
  assert.match(en, />6<\/span><span>Agents<\/span>/);
  assert.match(en, />4<\/span><span>Idle<\/span>/);
  assert.match(en, />12<\/span><span>Sessions<\/span>/);
  assert.doesNotMatch(en, /confirmed|[\u4e00-\u9fff]/i);
  assert.equal(render('zh-CN', summary), zh);
});

test('内置状态筛选全部跟随语言，切换语言不改变筛选标识和选中状态', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const html = render(locale, createElement(DashboardStatusFilters,
      { statuses: SYSTEM_STATUSES, filter: 'busy', onSelect: () => {} }));
    assert.deepEqual([...html.matchAll(/value="([^"]+)"/g)].map(match => match[1]),
      ['all', 'idle', 'busy', 'offline', 'waiting', 'unknown']);
    assert.match(html, /value="busy"[^>]*aria-pressed="true"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    if (locale === 'zh-CN') {
      for (const label of ['全部', '空闲', '工作中', '离线', '等待中', '状态未知']) assert.ok(html.includes(label));
      assert.doesNotMatch(html, />All<|>Idle<|>Working<|>Offline<|>Waiting<|>Unknown</);
    } else {
      for (const label of ['All', 'Idle', 'Working', 'Offline', 'Waiting', 'Unknown']) assert.ok(html.includes(label));
      assert.doesNotMatch(html, /[\u4e00-\u9fff]/);
    }
  }
});

const agent: Agent = { id: 'agent-fixture', name: '研究员 Alice', role: '原样角色',
  model: 'provider:model-fixture', description: '', status: 'idle', createdAt: '', updatedAt: '', tasksCompleted: 0 };
const base: AgentActivityView = { kind: 'idle', label: 'LEGACY_PRESENTATION',
  summary: '当前未观察到执行中的事项', source: 'Agent 活动状态', complete: true, events: [] };

test('卡片状态使用同一语言源，用户名称与角色不受标签翻译影响', () => {
  const idle = render('en-US', createElement(AgentCard, { agent, activity: base, onClick: () => {} }));
  assert.match(idle, /agent-card__status[^]*?>Idle<\/span>/);
  assert.match(idle, /研究员 Alice/);
  assert.match(idle, /原样角色/);
  assert.doesNotMatch(idle, /LEGACY_PRESENTATION|当前未观察/);
  const queued = { ...base, kind: 'running' as const,
    item: { operationId: 'queued-operation', title: 'User task', status: 'queued' as const } };
  const zhQueued = render('zh-CN', createElement(AgentCard, { agent, activity: queued, onClick: () => {} }));
  const enQueued = render('en-US', createElement(AgentCard, { agent, activity: queued, onClick: () => {} }));
  assert.match(zhQueued, /agent-card__status[^]*?>排队中<\/span>/);
  assert.match(enQueued, /agent-card__status[^]*?>Queued<\/span>/);
  const unknown = render('en-US', createElement(AgentCard, { agent,
    activity: { ...queued, kind: 'unknown' }, onClick: () => {} }));
  assert.match(unknown, /agent-card__status[^]*?>Unknown<\/span>/);
});

test('探针状态前缀翻译而原始错误保持可定位', () => {
  assert.equal(resolveMessage('zh-CN', 'dashboard.probeUnavailable', { error: 'HTTP 503' }),
    '状态探针暂不可用：HTTP 503');
  assert.equal(resolveMessage('en-US', 'dashboard.probeUnavailable', { error: 'HTTP 503' }),
    'Status probe is unavailable: HTTP 503');
});

test('忙碌但没有关联事项时，保留已知功能区的本地化提示', () => {
  for (const [surface, zh, en] of [
    ['conversation', '工作中 · 季风', 'Working · Monsoon'],
    ['cyclone', '工作中 · 气旋', 'Working · Cyclone'],
  ] as const) {
    const activity = projectAgentActivity({ ...agent, busy: true, activeSurfaces: [surface] },
      true, null, false);
    assert.equal(activity.item, undefined);
    for (const [locale, label] of [['zh-CN', zh], ['en-US', en]] as const) {
      const html = render(locale, createElement(AgentCard, { agent, activity, onClick: () => {} }));
      assert.ok(html.includes(`${label}</span>`));
    }
  }
  for (const activity of [
    { ...base, feature: 'cyclone' as const },
    { ...base, kind: 'running' as const, feature: 'cyclone' as const,
      item: { operationId: 'known-run', status: 'running' as const, title: 'User task' } },
  ]) {
    const html = render('en-US', createElement(AgentCard, { agent, activity, onClick: () => {} }));
    assert.doesNotMatch(html, /Working · Cyclone|Idle · Cyclone/);
  }
});
