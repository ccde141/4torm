import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TideSession } from '../../api/tide';
import { LocaleProvider } from '../../i18n/LocaleContext';

// Shared message rendering imports KaTeX styles, which have no server-rendering behavior.
registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
const { default: TideSessionView } = await import('./TideSessionView');

function session(messages: TideSession['messages']): TideSession {
  return { id: 'tide-session-view', agentId: 'agent-test', agentName: '研究员', title: '早间汇总',
    model: 'model-test', systemPrompt: 'PRIVATE_PROMPT', messages,
    createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:01:00Z' };
}

function render(value: TideSession, running = false) {
  return renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(TideSessionView, { session: value, running, onClose: () => {} })));
}

test('潮汐工具截图按打开的会话身份展示，同时保留原始工具文字结果', () => {
  const html = render(session([{ id: 'tool-result', role: 'tool-result',
    content: JSON.stringify({ tool: 'mcp:observe', result: 'metadata', ok: true }),
    toolImages: [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }] }]));
  assert.match(html, /metadata/);
  assert.match(html, /api\/tool-media\/tide\/shot-a\?agentId=agent-test&amp;sessionId=tide-session-view/);
  assert.match(html, /alt="desktop.png"/);
});

test('潮汐会话保留实际消息、独立会话身份及真实用量，不展示系统提示词', () => {
  const html = render({ ...session([
    { id: 'system', role: 'system', content: 'PRIVATE_SYSTEM_MESSAGE' },
    { id: 'user', role: 'user', content: '汇总本日资料', timestamp: '2026-10-21T00:00:00Z' },
    { id: 'assistant', role: 'assistant', content: '**已完成汇总**', timestamp: '2026-10-21T00:01:00Z' },
  ]), tokenUsage: { promptTokens: 1200, completionTokens: 60, totalTokens: 1260 } }, true);
  assert.match(html, /aria-label="会话记录"/);
  assert.match(html, /研究员/);
  assert.match(html, /2 条消息 · model-test/);
  assert.match(html, /1,200 tokens/);
  assert.match(html, /执行中/);
  assert.match(html, /汇总本日资料/);
  assert.match(html, /<strong>已完成汇总<\/strong>/);
  assert.doesNotMatch(html, /PRIVATE_PROMPT|PRIVATE_SYSTEM_MESSAGE/);
});

test('工具参数和结果保留完整内容，使用可展开的记录且区分失败结果', () => {
  const html = render(session([
    { id: 'call', role: 'tool-call', content: JSON.stringify({ tool: 'search', args: { count: 2, strict: true } }) },
    { id: 'result', role: 'tool-result', content: JSON.stringify({ tool: 'search', result: 'SOURCE_DETAIL', ok: false }) },
    { id: 'legacy', role: 'tool-result', content: 'LEGACY_TOOL_DETAIL' },
  ]));
  assert.equal((html.match(/<details class="tide-session__tool/g) ?? []).length, 3);
  assert.match(html, /tide-session__tool--error/);
  assert.match(html, /&quot;strict&quot;: true/);
  assert.match(html, /SOURCE_DETAIL/);
  assert.match(html, /LEGACY_TOOL_DETAIL/);
});

test('压缩后的历史分界线与最近内容仍可见，空会话提供反馈并禁用压缩', () => {
  const html = render(session([
    { id: 'old', role: 'user', content: '已归档的旧消息' },
    { id: 'marker', role: 'system', content: '[历史压缩记录] 原始摘要', type: 'compact-marker' },
    { id: 'latest', role: 'assistant', content: '最近原始回复' },
  ]));
  assert.match(html, /compaction-history__divider/);
  assert.match(html, /最近原始回复/);
  assert.doesNotMatch(html, /已归档的旧消息/);
  const empty = render(session([]));
  assert.match(empty, /暂无会话消息/);
  assert.match(empty, /<button class="tide-session__button" disabled="">/);
});
