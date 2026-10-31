import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TideRunRecord, TideTask } from '../../api/tide.js';
import { LocaleProvider } from '../../i18n/LocaleContext.js';
import TideRunHistory from './TideRunHistory.js';

const task: TideTask = {
  id: 'tide-history-fixture', name: '资料汇总', schedule: 'daily 08:00', prompt: '整理报告',
  agentId: 'agent-fixture', repeatCount: -1, pushMode: 'accumulate', windowN: 1,
  selfLoop: false, consecutiveErrors: 0, enabled: false, createdAt: '2026-10-01T00:00:00.000Z',
};
const run: TideRunRecord = {
  taskId: task.id, runId: 'history-run-fixture', timestamp: '2026-10-01T00:00:10.000Z',
  status: 'success', sessionId: 'session-fixture', sessionState: 'archived',
  answer: '汇总报告已完成', rawContent: '汇总报告已完成',
  toolCalls: [], turns: 2, durationMs: 1234,
  usage: { calls: 1, reportedCalls: 1, latest: { promptTokens: 4200, completionTokens: 120, totalTokens: 4320 } },
};

function render(runs: TideRunRecord[], overrides: Partial<TideTask> = {}) {
  return renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TideRunHistory, { task: { ...task, ...overrides }, runs, onViewSession: () => {} })));
}

test('归档运行截图使用该轮身份读取，不依赖当前绑定Agent或活动会话', () => {
  const html = render([{ ...run, toolCalls: [{ tool: 'mcp:observe', args: {}, result: 'metadata',
    toolImages: [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }] }] }],
    { agentId: 'new-agent' });
  assert.match(html, /api\/tool-media\/tide\/shot-a\?taskId=tide-history-fixture&amp;runId=history-run-fixture/);
  assert.match(html, /aria-label="查看原图：desktop.png"/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /agentId=new-agent/);
});

test('空运行历史有明确空状态，且不会制造运行或会话入口', () => {
  const html = render([]);
  assert.match(html, /运行历史 \(0\)/);
  assert.match(html, /暂无运行记录/);
  assert.doesNotMatch(html, /<ol|查看会话/);
  assert.match(html, /aria-labelledby="[^"]+"/);
});

test('独立归档轮完整展示工具事实、用量与可核查时间，且没有误导会话跳转', () => {
  const record = { ...run, toolCalls: [{ tool: 'read_file', args: { path: 'report.md' }, result: 'REPORT_CONTENT' }] };
  const html = render([record]);
  assert.match(html, /data-status="success"/);
  assert.match(html, /汇总报告已完成/);
  assert.match(html, /read_file/);
  assert.match(html, /report.md/);
  assert.match(html, /REPORT_CONTENT/);
  assert.match(html, /工具调用 \(1\)/);
  assert.match(html, /datetime="2026-10-01T00:00:10.000Z"/i);
  assert.match(html, /1234ms/);
  assert.match(html, /2 轮/);
  assert.match(html, /4,200/);
  assert.match(html, /本轮会话已归档/);
  assert.doesNotMatch(html, /查看会话|tide-run-card__session/);
});

test('失败记录保留明确失败状态和经过转义的错误信息', () => {
  const html = render([{ ...run, status: 'error', error: 'fetch failed <details>', answer: '' }]);
  assert.match(html, /data-status="error"/);
  assert.match(html, /✗ 失败/);
  assert.match(html, /fetch failed &lt;details&gt;/);
  assert.doesNotMatch(html, /✓ 成功/);
});

test('长答案支持原生可键盘展开的全文，不再永久截断到两百字符', () => {
  const html = render([{ ...run, answer: `${'报告内容'.repeat(100)}FINAL_RESULT` }]);
  assert.match(html, /<details class="tide-run-card__answer-details"/);
  assert.match(html, /<summary>/);
  assert.match(html, /展开完整结果/);
  assert.match(html, /收起结果/);
  assert.match(html, /FINAL_RESULT/);
  assert.match(html, /tide-run-card__preview/);
});

test('短结果和展开的完整结果采用会话 Markdown 格式，预览仍保留原文', () => {
  const short = render([{ ...run, answer: '# 汇总结果\n\n- **重点**：完成校验\n- 生成报告' }]);
  assert.match(short, /<h1>汇总结果<\/h1>/);
  assert.match(short, /<ul>/);
  assert.match(short, /<strong>重点<\/strong>/);
  const long = render([{ ...run, answer: `# 完整报告\n\n${'补充内容。'.repeat(80)}\n\n- **结论**：检查通过` }]);
  assert.match(long, /tide-run-card__preview"># 完整报告/);
  assert.match(long, /<h1>完整报告<\/h1>/);
  assert.match(long, /<li><strong>结论<\/strong>：检查通过<\/li>/);
});

test('超长全文与工具结果分页渲染，避免展开内容产生无界 DOM', () => {
  const longText = `${'A'.repeat(40_000)}UNRENDERED_TAIL`;
  const html = render([{ ...run, answer: longText,
    toolCalls: [{ tool: 'read_file', args: {}, result: longText }] }]);
  assert.match(html, /data-text-page="1"/);
  assert.match(html, /下一段/);
  assert.doesNotMatch(html, /UNRENDERED_TAIL/);
  assert.ok(html.length < 50_000, 'Two 40k-character records should render only their bounded initial pages');
});

test('滚动潮汐和指定季风记录提供按钮入口，缺少会话标识则不生成空跳转', () => {
  for (const overrides of [{ windowN: 2 }, { pushMode: 'designated' as const }]) {
    const html = render([{ ...run, sessionState: 'retained' }], overrides);
    assert.match(html, /<button type="button" class="tide-run-card__session"/);
    assert.match(html, /查看会话/);
    assert.doesNotMatch(html, /本轮会话已归档|href="#"/);
  }
  assert.doesNotMatch(render([{ ...run, sessionId: '' }], { windowN: 2 }), /查看会话/);
});

test('修改当前任务保留轮数或推送模式，不会改写过去运行的会话入口与归档事实', () => {
  const archived = render([run], { pushMode: 'designated', windowN: 4 });
  assert.match(archived, /本轮会话已归档/);
  assert.doesNotMatch(archived, /查看会话/);
  for (const pushMode of ['accumulate', 'designated'] as const) {
    const retained = render([{ ...run, pushMode, sessionState: 'retained' }]);
    assert.match(retained, /查看会话/);
    assert.doesNotMatch(retained, /本轮会话已归档/);
  }
});

test('未记录归档快照的旧运行保持可查询入口，不按当前 N=1 伪造已归档结论', () => {
  for (const pushMode of [undefined, 'accumulate', 'designated'] as const) {
    const legacy = render([{ ...run, pushMode, sessionState: undefined }]);
    assert.match(legacy, /查看会话/);
    assert.doesNotMatch(legacy, /本轮会话已归档/);
  }
});

test('主动中止的运行显示独立终态，不误报成功或模型失败', () => {
  const html = render([{ ...run, status: 'aborted', answer: '', rawContent: '',
    error: '本轮潮汐执行已中止' }]);
  assert.match(html, /data-status="aborted"/);
  assert.match(html, /已中止/);
  assert.doesNotMatch(html, /✓ 成功|✗ 失败/);
});
