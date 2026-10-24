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

function renderMessage(message: ChatMessage) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(LocaleProvider, null, createElement(MessageItem, {
    msg: message, agent: null, sessionId: 'session-fixture', isStreaming: false, isEditing: false,
    editContent: '', setEditContent: noop, onSaveEdit: noop, onCancelEdit: noop,
    onStartEdit: noop, onDeleteMessage: noop, onAskReply: noop,
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
