import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import type { TideTask } from '../../api/tide';
import TideTaskItem from './TideTaskItem';

test('任务卡片展开中止记录时不显示红色 ERR', () => {
  const task: TideTask = { id: 'task-abort', name: '中止测试', agentId: 'worker', schedule: 'daily 08:00',
    prompt: '执行', repeatCount: -1, pushMode: 'accumulate', windowN: 2,
    selfLoop: false, consecutiveErrors: 0, enabled: false, createdAt: '2026-10-21T00:00:00Z' };
  const noOp = () => {};
  const html = renderToStaticMarkup(createElement(LocaleProvider, null, createElement(TideTaskItem, {
    task, selected: true, expanded: true, onToggle: noOp, onDelete: noOp, onRunNow: noOp,
    onExpand: noOp, runs: [{ taskId: task.id, status: 'aborted', runId: 'aborted-run',
      timestamp: task.createdAt, sessionId: 'session', error: '本轮已中止',
      answer: '', rawContent: '', toolCalls: [], turns: 0, durationMs: 1 }],
  })));
  assert.match(html, /已中止/);
  assert.doesNotMatch(html, /ERR|color:#ef4444[^>]*> 本轮已中止/);
});
