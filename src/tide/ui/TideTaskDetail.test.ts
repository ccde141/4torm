import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TideTask } from '../../api/tide.js';
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
        status: 'success', sessionId: 'session-test', answer: 'WAIT_DONE', rawContent: 'WAIT_DONE',
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
  const render = (compactionNotice?: string) => renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TideTaskDetail, { task, runs: [record],
      runState: { schemaVersion: 1, taskId: task.id, runId: 'tide-run-live', trigger: 'schedule',
        status: 'running', createdAt: task.createdAt, updatedAt: task.createdAt, compactionNotice },
      onViewSession: () => {}, onDeleteSession: () => {}, onUpdated: () => {} })));
  assert.match(render('压缩服务离线，正在切换模型'), /压缩服务离线，正在切换模型/);
  assert.doesNotMatch(render(), /compaction-notice|上次已确认的压缩错误/);
});
