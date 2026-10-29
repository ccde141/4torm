import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TideRunState, TideTask } from '../../api/tide.js';
import { LocaleProvider } from '../../i18n/LocaleContext.js';
import TideTaskDetail from './TideTaskDetail.js';

test('每轮归档后运行详情仍能审查实际工具调用与结果', () => {
  const task: TideTask = {
    id: 'tide-test', name: '回归', schedule: 'every 10s', prompt: '等待',
    agentId: 'agent-test', repeatCount: 0, pushMode: 'accumulate', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled: true, createdAt: '2026-10-01T00:00:00.000Z',
  };
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TideTaskDetail, {
      task,
      runs: [{ taskId: task.id, timestamp: '2026-10-01T00:00:10.000Z',
        status: 'success', sessionId: 'session-test', sessionState: 'archived',
        answer: 'WAIT_DONE', rawContent: 'WAIT_DONE',
        toolCalls: [{ tool: 'run_command', args: { command: 'echo waited' }, result: 'waited' }],
        turns: 1, durationMs: 100 }],
      onViewSession: () => {}, onDeleteSession: () => {}, onUpdated: () => {},
    }),
  ));
  assert.match(html, /WAIT_DONE/);
  assert.match(html, /run_command/);
  assert.match(html, /waited/);
  assert.doesNotMatch(html, /查看会话/);
});

test('current run facts show an in-flight compaction notice, while old run history cannot resurrect an acknowledged notice', () => {
  const task: TideTask = { id: 'tide-test', name: '巡检', schedule: 'every 5m', prompt: '检查',
    agentId: 'agent-test', repeatCount: -1, pushMode: 'accumulate', windowN: 6,
    selfLoop: false, consecutiveErrors: 0, enabled: true, createdAt: '2026-10-01T00:00:00.000Z' };
  const record = { taskId: task.id, timestamp: '2026-10-01T00:00:10.000Z', status: 'success' as const,
    sessionId: 'session-test', answer: 'done', rawContent: 'done', toolCalls: [],
    turns: 1, durationMs: 100, notices: ['上次已确认的压缩错误'] };
  const render = (compactionNotice?: string, compaction?: TideRunState['compaction']) => renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TideTaskDetail, { task, runs: [record],
      runState: { schemaVersion: 1, taskId: task.id, runId: 'tide-run-live', trigger: 'schedule',
        status: 'running', createdAt: task.createdAt, updatedAt: task.createdAt, compactionNotice, compaction },
      onViewSession: () => {}, onDeleteSession: () => {}, onUpdated: () => {} })));
  assert.match(render('压缩服务离线，正在切换模型'), /压缩服务离线，正在切换模型/);
  assert.doesNotMatch(render(), /compaction-notice|上次已确认的压缩错误/);
  const now = Date.now();
  const progress = { id: 'compact-1', operation: 'compact' as const, reason: 'threshold' as const,
    startedAt: now, updatedAt: now };
  assert.match(render(undefined, { ...progress, type: 'compact-start' }), /正在压缩并归档/);
  assert.doesNotMatch(render(undefined, { ...progress, type: 'compact-done', updatedAt: now - 5_000 }),
    /role="status"|已压缩并归档/);
});

test('每日定时详情同时显示触发时间、运行电脑时区规则和实际下次时点', () => {
  const task: TideTask = {
    id: 'tide-daily', name: '早间汇总', schedule: 'daily 08:00', prompt: '汇总',
    agentId: 'agent-test', repeatCount: -1, pushMode: 'accumulate', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled: true, createdAt: '2026-10-01T00:00:00.000Z',
    nextRun: '2026-10-23T00:00:00.000Z',
  };
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TideTaskDetail, { task, runs: [], runState: null,
      onViewSession: () => {}, onDeleteSession: () => {}, onUpdated: () => {} })));
  assert.match(html, /每天 08:00/);
  assert.match(html, /运行后端的电脑当前时区/);
  assert.match(html, /错过的时间不补跑/);
  assert.ok(html.includes(new Date(task.nextRun!).toLocaleString('zh-CN', { timeZoneName: 'short' })));
});

test('删除活跃会话入口仅用于暂停且未运行的潮汐独立会话', () => {
  const task: TideTask = { id: 'tide-delete', name: '会话删除', schedule: 'daily 08:00', prompt: '执行',
    agentId: 'agent-test', repeatCount: -1, pushMode: 'accumulate', windowN: 2,
    targetSessionId: 'active-session', selfLoop: false, consecutiveErrors: 0, enabled: false,
    createdAt: '2026-10-21T00:00:00Z' };
  const render = (overrides: Partial<TideTask> = {}, running = false) => renderToStaticMarkup(
    createElement(LocaleProvider, null, createElement(TideTaskDetail, { task: { ...task, ...overrides },
      runs: [], runState: null, running, onViewSession() {}, onDeleteSession: async () => {}, onUpdated() {} })));
  assert.match(render(), /删除活跃会话（保留归档）/);
  for (const html of [render({ enabled: true }), render({}, true), render({ pushMode: 'designated' }),
    render({ targetSessionId: undefined })]) assert.doesNotMatch(html, /删除活跃会话/);
});
