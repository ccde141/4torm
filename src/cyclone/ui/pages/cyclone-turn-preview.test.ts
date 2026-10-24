import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../../i18n/LocaleContext';
import type { SeatTurn } from './seat-turn-projection';
import type { FeedMsg } from './room-stream-events';

registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
const { default: SeatTurnCard } = await import('./SeatTurnCard');
const { default: RoomFeedRow } = await import('./RoomFeedRow');

const turn: SeatTurn = {
  id: 'seat-turn-fixture', messages: [], reasoning: '工位思考记录', finalContent: '工位最终答复',
  workSegments: [
    { content: '工位操作前说明', blocks: [] },
    { content: '', blocks: [{ kind: 'tool', tool: 'read_file', args: { path: 'fixture.md' },
      result: '工位核验结果', status: 'success' }] },
    { content: '工位操作后说明', blocks: [] },
  ],
};

function renderSeat(streaming = false, source = turn) {
  return renderToStaticMarkup(createElement(LocaleProvider, null, createElement(SeatTurnCard, {
    turn: source, dispatches: [], onAskReply: () => {}, streaming,
  })));
}

const room: FeedMsg = {
  key: 'room-turn-fixture', speaker: '核验工位', isHuman: false, content: '群聊最终答复',
  reasoning: '群聊思考记录', tools: [], segments: [
    { kind: 'text', content: '群聊操作前说明' },
    { kind: 'tools', tools: [{ tool: 'run_command', args: { command: 'fixture-only' },
      result: '群聊核验结果', status: 'success' }] },
    { kind: 'text', content: '群聊最终答复' },
  ],
};

function renderRoom(streaming = false, failed = false, source = room) {
  const noop = () => {};
  const message: FeedMsg = { ...source, streaming, segments: source.segments?.map(segment => failed && segment.kind === 'tools'
    ? { ...segment, tools: segment.tools.map(tool => ({ ...tool, status: 'error' })) } : segment) };
  return renderToStaticMarkup(createElement(LocaleProvider, null, createElement(RoomFeedRow, {
    m: message, idx: 0, prefix: 'fixture', editing: false, editContent: '',
    onEditContent: noop, onStartEdit: noop, onSaveEdit: noop, onCancelEdit: noop, onDelete: noop,
    dispatches: [], highlightedId: null, onDispatchAction: async () => {}, onOpenSeat: noop,
  })));
}

test('completed seat turns keep their work and reasoning visible in limited-height previews', () => {
  const html = renderSeat();
  for (const text of ['工位思考记录', '工位操作前说明', 'read_file', '工位操作后说明', '工位最终答复']) {
    assert.ok(html.includes(text), `Missing visible content: ${text}`);
  }
  assert.match(html, /class="cyclone-seat-turn__worklog-summary"[^>]*aria-expanded="true"/);
  assert.match(html, /class="cyclone-seat-turn__worklog-height"[^>]*aria-pressed="false"[^>]*>完整高度<\/button>/);
  assert.match(html, /<\/button><button[^>]*class="cyclone-seat-turn__worklog-height"/);
  assert.match(html, /cyclone-seat-turn__worklog-icon/);
  assert.match(html, /cyclone-seat-turn__answer--separated/);
  assert.match(html, /class="cyclone-seat-turn__worklog-body"[^>]*role="region"/);
  assert.doesNotMatch(html, /<details class="cyclone-seat-turn__worklog"/);
  assert.ok(html.indexOf('工位操作前说明') < html.indexOf('read_file'));
  assert.ok(html.indexOf('read_file') < html.indexOf('工位操作后说明'));
  assert.ok(html.indexOf('工位操作后说明') < html.indexOf('工位最终答复'));
});

test('completed room turns retain visible ordered work notes and a separate final answer', () => {
  const html = renderRoom();
  for (const text of ['群聊思考记录', '群聊操作前说明', 'run_command', '群聊最终答复']) {
    assert.ok(html.includes(text), `Missing visible content: ${text}`);
  }
  assert.match(html, /class="cyclone-room-turn__worklog-summary"[^>]*aria-expanded="true"/);
  assert.match(html, /class="cyclone-room-turn__worklog-height"[^>]*aria-pressed="false"[^>]*>完整高度<\/button>/);
  assert.match(html, /<\/button><button[^>]*class="cyclone-room-turn__worklog-height"/);
  assert.match(html, /cyclone-room-turn__worklog-icon/);
  assert.match(html, /cyclone-room-turn__answer--separated/);
  assert.match(html, /class="cyclone-room-turn__worklog-body"[^>]*role="region"/);
  assert.doesNotMatch(html, /<details class="cyclone-room-turn__worklog"/);
  assert.ok(html.indexOf('群聊操作前说明') < html.indexOf('run_command'));
  assert.ok(html.indexOf('run_command') < html.indexOf('群聊最终答复'));
});

test('running work remains in preview height instead of forcing an unrestricted expansion', () => {
  for (const html of [renderSeat(true), renderRoom(true)]) {
    assert.match(html, /完整高度/);
    assert.match(html, /thinking-card__tool-spinner/);
    assert.doesNotMatch(html, /worklog-body is-expanded/);
  }
});

test('failed room work remains visible without replacing the selected preview height', () => {
  const html = renderRoom(false, true);
  assert.match(html, /class="cyclone-room-turn__worklog-summary"[^>]*aria-expanded="true"/);
  assert.match(html, /群聊操作前说明/);
  assert.match(html, /cyclone-room-turn__tool--error/);
  assert.match(html, /群聊最终答复/);
  assert.doesNotMatch(html, /worklog-body is-expanded/);
});

test('answers without earlier reasoning or work do not add an empty separator', () => {
  const seat = renderSeat(false, { ...turn, reasoning: undefined, workSegments: [] });
  const roomAnswer = renderRoom(false, false, { ...room, reasoning: undefined,
    segments: [{ kind: 'text', content: room.content }] });
  for (const html of [seat, roomAnswer]) {
    assert.doesNotMatch(html, /answer--separated|worklog-summary|reasoning-block--preview/);
    assert.match(html, /最终答复/);
  }
});
