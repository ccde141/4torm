import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import type { ChatMessage } from '../../types';

// Styles have no server-rendering behavior; the real components are still rendered.
registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
const { default: MonsoonActivitySequence } = await import('./MonsoonActivitySequence');
const { default: MessageItem } = await import('./MessageItem');

const fixture: ChatMessage = {
  id: 'turn-fixture', role: 'assistant', timestamp: '2026-10-24T08:00:00Z',
  content: '阶段说明甲\n\n阶段说明乙\n\n面向用户的最终答复',
  toolSteps: [
    { tool: 'read_file', args: { path: 'fixture-a.md' }, result: '已读甲', status: 'done' },
    { tool: 'run_command', args: { command: 'fixture-only' }, result: '已核验乙', status: 'done' },
  ],
  activitySequence: [
    { kind: 'text', content: '阶段说明甲' }, { kind: 'tool', index: 0 },
    { kind: 'team', event: { id: 'report-fixture', memberId: 'seat-fixture', memberName: '核验工位',
      stage: 'reported', timestamp: '2026-10-24T08:00:01Z', preview: '已收到核验回报' } },
    { kind: 'text', content: '阶段说明乙' }, { kind: 'tool', index: 1 },
    { kind: 'text', content: '面向用户的最终答复' },
  ],
};

function renderSequence(message: ChatMessage, options: Partial<ComponentProps<typeof MonsoonActivitySequence>> = {}) {
  return renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(MonsoonActivitySequence, {
      message, renderTools: (steps, offset) => steps.map((step, index) => createElement('article',
        { key: index, 'data-fixture-tool': offset + index }, `${step.tool} ${step.result}`)),
      ...options,
    })));
}

function renderMessage(message: ChatMessage, options: Partial<ComponentProps<typeof MessageItem>> = {}) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(LocaleProvider, null, createElement(MessageItem, {
    msg: message, agent: null, sessionId: 'session-fixture', isStreaming: false, isEditing: false,
    editContent: '', setEditContent: noop, onSaveEdit: noop, onCancelEdit: noop,
    onStartEdit: noop, onDeleteMessage: noop, onAskReply: noop,
    ...options,
  })));
}

test('one assistant turn keeps notes, tools and reports in one ordered worklog', () => {
  const html = renderSequence(fixture, { streaming: true,
    reasoning: createElement('aside', null, '本轮思考记录'),
    phase: createElement('span', null, '正在核验结果') });
  assert.equal((html.match(/class="chat__avatar"/g) ?? []).length, 1);
  assert.equal((html.match(/class="monsoon-turn__worklog-summary"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /turn-process-toolbar/);
  assert.equal((html.match(/完整高度/g) ?? []).length, 1);
  assert.match(html, /本轮思考记录/);
  assert.match(html, /正在核验结果/);
  const markers = ['阶段说明甲', 'read_file', '已收到核验回报', '阶段说明乙', 'run_command', '面向用户的最终答复'];
  const positions = markers.map(marker => html.indexOf(marker));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.ok(html.indexOf('面向用户的最终答复') > html.indexOf('</section>'));
});

test('completed work remains visible in its default height-limited preview', () => {
  const html = renderSequence(fixture);
  assert.match(html, /class="monsoon-turn__worklog-summary"[^>]*aria-expanded="true"/);
  assert.match(html, /class="monsoon-turn__worklog-toggle"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(html, /hidden=""/);
  assert.match(html, /面向用户的最终答复/);
  assert.match(html, /阶段说明甲/);
  assert.match(html, /阶段说明乙/);
  assert.match(html, /class="monsoon-turn__worklog-body"/);
  assert.doesNotMatch(html, /monsoon-turn__worklog-body is-expanded/);
});

test('a turn ending in a tool keeps prior notes inside its visible worklog without inventing an answer', () => {
  const message: ChatMessage = { ...fixture, content: '阶段说明甲', streamStopped: true,
    activitySequence: fixture.activitySequence!.slice(0, 2) };
  const html = renderSequence(message);
  assert.match(html, /class="monsoon-turn__worklog-summary"[^>]*aria-expanded="true"/);
  assert.equal((html.match(/阶段说明甲/g) ?? []).length, 1);
  assert.doesNotMatch(html, /monsoon-turn__answer|面向用户的最终答复/);
});

test('stopping a turn does not mark already completed tool records as missing results', () => {
  const message: ChatMessage = { ...fixture, content: '阶段说明甲', streamStopped: true,
    activitySequence: [{ kind: 'text', content: '阶段说明甲' }, { kind: 'tool', index: 0 }, { kind: 'tool', index: 1 }] };
  const html = renderMessage(message);
  assert.match(html, /已完成/);
  assert.doesNotMatch(html, /尚未收到结果|停止时尚未收到结果/);
  assert.equal((html.match(/class="monsoon-turn__worklog-summary"/g) ?? []).length, 1);
});

test('only unfinished tools retain an interruption state when the turn stops', () => {
  const message: ChatMessage = { ...fixture, content: '阶段说明甲', streamStopped: true,
    toolSteps: [{ tool: 'read_file', args: { path: 'fixture-a.md' }, status: 'running' }],
    activitySequence: [{ kind: 'text', content: '阶段说明甲' }, { kind: 'tool', index: 0 }] };
  const html = renderMessage(message);
  assert.match(html, /停止时尚未收到结果|已停止[^<]*尚未收到结果/);
  assert.doesNotMatch(html, /thinking-card__tool-spinner|chat__tool-running/);
});

test('plain legacy answers keep their normal message presentation', () => {
  const html = renderMessage({ id: 'legacy-fixture', role: 'assistant', timestamp: '', content: '旧会话最终正文' });
  assert.match(html, /旧会话最终正文/);
  assert.equal((html.match(/class="chat__avatar"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /monsoon-turn__worklog-summary/);
});

test('report retries render once per stage with their earliest recorded time and original work order', () => {
  const event = { id: 'old-report', reportId: 'report-fixture', memberId: 'member-fixture',
    memberName: '核验工位', stage: 'reported' as const, timestamp: '2026-10-26T04:49:00Z', preview: '回报摘要' };
  const message: ChatMessage = { ...fixture, content: '执行前说明最终答复', activitySequence: [
    { kind: 'text', content: '执行前说明' }, { kind: 'team', event }, { kind: 'tool', index: 0 },
    { kind: 'team', event: { ...event, id: 'retry-report', timestamp: '2026-10-25T14:00:00Z' } },
    { kind: 'team', event: { ...event, id: 'injected-report', stage: 'injected',
      timestamp: '2026-10-25T14:01:00Z' } }, { kind: 'text', content: '最终答复' },
  ] };
  const original = structuredClone(message);
  const html = renderSequence(message);
  assert.equal((html.match(/class="monsoon-team-event" data-stage="reported"/g) ?? []).length, 1);
  assert.equal((html.match(/class="monsoon-team-event" data-stage="injected"/g) ?? []).length, 1);
  assert.match(html, /dateTime="2026-10-25T14:00:00Z"/);
  assert.doesNotMatch(html, /dateTime="2026-10-26T04:49:00Z"/);
  const positions = ['执行前说明', '已收到回报', 'read_file', '回报已加入上下文', '最终答复']
    .map(marker => html.indexOf(marker));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.deepEqual(message, original);
});

test('compaction starts a fresh visible process with its own count and retains every earlier record', () => {
  const message: ChatMessage = { ...fixture, content: '压缩前说明压缩后说明最终回复',
    activitySequence: [{ kind: 'text', content: '压缩前说明' }, { kind: 'tool', index: 0 },
      { kind: 'compact', markerId: 'compact-fixture', toolOffset: 1, timestamp: fixture.timestamp },
      { kind: 'text', content: '压缩后说明' }, { kind: 'tool', index: 1 }, { kind: 'text', content: '最终回复' }] };
  const marker: ChatMessage = { id: 'compact-fixture', role: 'system', type: 'compact-marker',
    timestamp: fixture.timestamp, content: '[历史压缩记录]\n交接正文',
    execution: { assistantId: message.id, toolOffset: 1 } };
  const original = structuredClone(message);
  const html = renderSequence(JSON.parse(JSON.stringify(message)) as ChatMessage,
    { streaming: true, compactionMarkers: [marker], reasoning: createElement('aside', null, '完整思考') });
  assert.equal((html.match(/class="monsoon-turn__worklog-summary"/g) ?? []).length, 2);
  assert.equal((html.match(/class="chat__bubble monsoon-turn__bubble"/g) ?? []).length, 2);
  assert.equal((html.match(/class="chat__avatar"/g) ?? []).length, 2);
  assert.equal((html.match(/1 项工具操作/g) ?? []).length, 2);
  assert.match(html, /已接续/);
  assert.match(html, /进行中/);
  assert.equal((html.match(/完整思考/g) ?? []).length, 1);
  assert.equal((html.match(/上下文已压缩 · 查看交接/g) ?? []).length, 1);
  assert.equal((html.match(/完整高度/g) ?? []).length, 2);
  assert.match(html, /data-tool-offset="0"/);
  assert.match(html, /data-tool-offset="1"/);
  assert.equal((html.match(/data-tool-start="1"/g) ?? []).length, 2);
  const order = ['压缩前说明', 'read_file', '上下文已压缩', '压缩后说明', 'run_command', '最终回复']
    .map(text => html.indexOf(text));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(html, /交接正文/); // The potentially long handoff mounts only when requested.
  assert.deepEqual(message, original);
});

test('a newly compacted process shows an empty continuation while waiting for the next model response', () => {
  const html = renderSequence({ ...fixture, content: '前段说明', activitySequence: [
    { kind: 'text', content: '前段说明' }, { kind: 'tool', index: 0 },
    { kind: 'compact', markerId: 'compact-empty', toolOffset: 1, timestamp: fixture.timestamp },
  ] }, { streaming: true });
  assert.equal((html.match(/class="monsoon-turn__worklog-summary"/g) ?? []).length, 2);
  assert.match(html, /已接续/);
  assert.match(html, /进行中/);
  assert.equal((html.match(/上下文已压缩/g) ?? []).length, 1);
  assert.equal((html.match(/data-fixture-tool="0"/g) ?? []).length, 1);
});

test('multiple boundaries remain separate after refresh without duplicating historical reasoning or tool content', () => {
  const message: ChatMessage = { ...fixture, content: '最终回复', activitySequence: [
    { kind: 'tool', index: 0 }, { kind: 'compact', markerId: 'compact-first', toolOffset: 1, timestamp: '' },
    { kind: 'tool', index: 1 }, { kind: 'compact', markerId: 'compact-second', toolOffset: 2, timestamp: '' },
    { kind: 'compact', markerId: 'compact-first', toolOffset: 1, timestamp: '' },
    { kind: 'text', content: '最终回复' },
  ] };
  const html = renderSequence(JSON.parse(JSON.stringify(message)) as ChatMessage,
    { reasoning: createElement('aside', null, '全部思考') });
  assert.equal((html.match(/data-marker-id=/g) ?? []).length, 2);
  assert.equal((html.match(/已接续/g) ?? []).length, 2);
  assert.equal((html.match(/全部思考/g) ?? []).length, 1);
  assert.equal((html.match(/read_file/g) ?? []).length, 1);
  assert.equal((html.match(/run_command/g) ?? []).length, 1);
  assert.equal((html.match(/最终回复/g) ?? []).length, 1);
});

test('compaction before the first model request does not invent a completed empty execution', () => {
  const html = renderSequence({ ...fixture, content: '', toolSteps: [], activitySequence: [
    { kind: 'compact', markerId: 'before-first-request', toolOffset: 0, timestamp: '' },
  ] }, { streaming: true });
  assert.equal((html.match(/class="monsoon-turn__worklog-summary"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /已接续|0 项工具操作/);
  assert.match(html, /进行中/);
  assert.match(html, /上下文已压缩/);
});

test('a handoff renders inline once, while unlinked and legacy history markers remain accessible', () => {
  const marker: ChatMessage = { id: 'compact-linked', role: 'system', content: '[历史压缩记录]\n交接',
    timestamp: '', type: 'compact-marker', execution: { assistantId: 'turn-fixture', toolOffset: 0 } };
  assert.equal(renderMessage(marker, { inlineCompaction: true }), '');
  assert.match(renderMessage(marker), /compaction-history/);
  assert.match(renderMessage(marker), /上下文已压缩 · 查看交接/);
  assert.match(renderMessage({ ...marker, execution: undefined }), /compaction-history/);
});

test('each continuation has its own bubble and exact reasoning slice with one shared edit scope', () => {
  const before = '压缩前的思考';
  const after = '压缩后的思考';
  const marker: ChatMessage = { id: 'separate-bubbles', role: 'system', content: '[历史压缩记录]\n交接',
    timestamp: '', type: 'compact-marker', execution: { assistantId: fixture.id, toolOffset: 1, reasoningOffset: before.length } };
  const message: ChatMessage = { ...fixture, content: '前段正文后段正文最终回复', reasoningContent: before + after,
    reasoningBreaks: [before.length, before.length + 2], activitySequence: [
      { kind: 'text', content: '前段正文' }, { kind: 'tool', index: 0 },
      { kind: 'compact', markerId: marker.id, toolOffset: 1, timestamp: '', reasoningOffset: before.length },
      { kind: 'text', content: '后段正文' }, { kind: 'tool', index: 1 }, { kind: 'text', content: '最终回复' },
    ] };
  const original = structuredClone(message);
  const html = renderMessage(JSON.parse(JSON.stringify(message)) as ChatMessage, { compactionMarkers: [marker] });
  assert.equal((html.match(/class="chat__bubble monsoon-turn__bubble"/g) ?? []).length, 2);
  assert.equal((html.match(/reasoning-block reasoning-block--open reasoning-block--preview/g) ?? []).length, 2);
  assert.equal((html.match(/压缩前的思考/g) ?? []).length, 1);
  assert.equal((html.match(/前段正文/g) ?? []).length, 1);
  assert.equal((html.match(/后段正文/g) ?? []).length, 1);
  assert.equal((html.match(/最终回复/g) ?? []).length, 1);
  const text = html.replace(/<[^>]*>/g, '');
  const divider = text.indexOf('上下文已压缩 · 查看交接');
  assert.ok(text.indexOf(before) < divider);
  assert.ok(text.indexOf(after) > divider);
  assert.equal(text.split(after).length - 1, 1);
  assert.equal((html.match(/class="chat__bubble-actions"/g) ?? []).length, 1);
  assert.deepEqual(message, original);
});

test('long worklogs mount a bounded latest window with original tool indexes', () => {
  const steps = Array.from({ length: 241 }, (_, index) => ({ tool: 'framework_status',
    args: { index }, result: `result-${index}`, status: 'done' as const }));
  const message: ChatMessage = { ...fixture, content: '最终答复', toolSteps: steps,
    activitySequence: [...steps.map((_, index) => ({ kind: 'tool' as const, index })),
      { kind: 'text', content: '最终答复' }] };
  const original = structuredClone(message);
  const html = renderSequence(message, { streaming: true });
  assert.equal((html.match(/data-fixture-tool=/g) ?? []).length, 80);
  assert.doesNotMatch(html, /data-fixture-tool="0"/);
  assert.match(html, /data-fixture-tool="161"/);
  assert.match(html, /data-fixture-tool="240"/);
  assert.match(html, /data-tool-start="162"/);
  assert.match(html, /241 项工具操作/);
  assert.match(html, /上一段/);
  assert.match(html, /下一段/);
  assert.match(html, /最终答复/);
  assert.deepEqual(message, original);
});

test('bounded windows retain the exact tool offsets on both sides of compaction', () => {
  const steps = Array.from({ length: 250 }, (_, index) => ({ tool: 'framework_status',
    args: { index }, result: `result-${index}`, status: 'done' as const }));
  const message: ChatMessage = { ...fixture, content: '继续执行', toolSteps: steps,
    activitySequence: [...steps.slice(0, 125).map((_, index) => ({ kind: 'tool' as const, index })),
      { kind: 'compact', markerId: 'long-window-boundary', toolOffset: 125, timestamp: '' },
      ...steps.slice(125).map((_, index) => ({ kind: 'tool' as const, index: 125 + index })),
      { kind: 'text', content: '继续执行' }] };
  const original = structuredClone(message);
  const html = renderSequence(message);
  assert.equal((html.match(/data-fixture-tool=/g) ?? []).length, 160);
  assert.match(html, /data-fixture-tool="45"/);
  assert.match(html, /data-fixture-tool="124"/);
  assert.match(html, /data-fixture-tool="170"/);
  assert.match(html, /data-fixture-tool="249"/);
  assert.equal((html.match(/data-tool-start="46"/g) ?? []).length, 2);
  assert.equal((html.match(/data-marker-id="long-window-boundary"/g) ?? []).length, 1);
  assert.match(html, /data-tool-offset="125"/);
  assert.deepEqual(message, original);
});
