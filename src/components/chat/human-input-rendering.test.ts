import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import HumanInputList from './HumanInputList';
import PendingHumanInput from './PendingHumanInput';
import type { ChatMessage } from '../../types';
import type { PendingInput } from '../../engine/chat/input-outbox';

const input = { id: 'input', agentId: 'agent', sessionId: 'session', runId: 'run', content: 'Keep the correction' };
const pending: PendingInput = { input, state: 'retained', error: 'Connection lost' };
const message: ChatMessage = { id: 'answer', role: 'assistant', content: '', timestamp: 'now', humanInputs: [
  { ...input, receivedAt: 'now', sequence: 1, state: 'included' },
] };

test('an included receipt ignores stale local errors and recovery buttons', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, { children: createElement(HumanInputList,
    { message, pending: [pending], onCheck: () => {} }) }));
  assert.match(html, /chat__message--steering/);
  assert.match(html, /Keep the correction/);
  assert.doesNotMatch(html, /Connection lost|<button|chat__input-area/);
});

test('retained receipt recovery stays inside its existing bubble', () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, { children: createElement(HumanInputList,
    { message: { ...message, humanInputs: [{ ...message.humanInputs![0], state: 'retained' }] },
      pending: [pending], onCheck: () => {} }) }));
  assert.equal(html.match(/Keep the correction/g)?.length, 1);
  assert.match(html, /Connection lost/);
  assert.match(html, /<button/);
  assert.doesNotMatch(html, /chat__input-area/);
});

test('an outbox-only receipt uses a user bubble without offering checks for accepted input', () => {
  const html = renderToStaticMarkup(createElement(PendingHumanInput,
    { pending: { input, state: 'received' }, busy: false, english: false, onCheck: () => {} }));
  assert.match(html, /chat__message--steering/);
  assert.match(html, /已接收 · 等待处理/);
  assert.doesNotMatch(html, /chat__input-area|<button/);
});

test('durable and outbox-only receipts show the same tool wait without changing their receipt state', () => {
  const activity = { runId: 'run', phase: 'tool-exec' as const };
  const receipt = { ...message, humanInputs: [{ ...message.humanInputs![0], state: 'received' as const }] };
  const durable = renderToStaticMarkup(createElement(LocaleProvider, { children: createElement(HumanInputList,
    { message: receipt, activity }) }));
  const local = renderToStaticMarkup(createElement(PendingHumanInput,
    { pending: { input, state: 'received' }, activity, busy: false, english: false, onCheck: () => {} }));
  for (const html of [durable, local]) {
    assert.match(html, /已接收 · 等待当前工具结束/);
    assert.match(html, /chat__human-input-status--received/);
    assert.doesNotMatch(html, /已纳入上下文|<button|chat__input-area/);
  }
  assert.equal(receipt.humanInputs[0].state, 'received');
});
