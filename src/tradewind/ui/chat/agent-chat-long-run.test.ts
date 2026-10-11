import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage } from '../../../types';
import { LocaleProvider } from '../../../i18n/LocaleContext';
import AgentChatView from './AgentChatView';
import { createDelegateFrameBuffer, mergeDelegateChunks } from './agent-chat-runtime';

test('隐藏的持久 Agent 面板不渲染不断增长的消息历史', () => {
  const messages: ChatMessage[] = Array.from({ length: 2_000 }, (_, index) => ({
    id: `message-${index}`,
    role: 'assistant',
    content: '长时间运行产生的消息',
    timestamp: '2026-01-01T00:00:00.000Z',
  }));
  const noop = () => undefined;
  const view = createElement(AgentChatView, {
    visible: false, sealed: false, paused: false, streaming: true,
    isEnvelopeRound: false, activity: 'responding', nodeLabel: 'Agent',
    messages, error: null, input: '', messagesContainerRef: { current: null },
    messagesEndRef: { current: null }, onClose: noop, onInput: noop,
    onKeyDown: noop, onSend: noop, onStop: noop, onPauseRound: noop,
    onResumeRound: noop, onStopWorkflow: noop,
  });
  assert.equal(renderToStaticMarkup(createElement(LocaleProvider, null, view)), '');
});

test('大量委托 token 只排一个绘制帧，工具边界可同步冲刷', () => {
  const callbacks = new Map<number, () => void>();
  const emitted: Array<ReadonlyMap<string, string>> = [];
  let nextFrame = 0;
  const buffer = createDelegateFrameBuffer(
    chunks => emitted.push(chunks),
    callback => { const id = ++nextFrame; callbacks.set(id, callback); return id; },
    id => { callbacks.delete(id); },
  );
  for (let index = 0; index < 10_000; index++) buffer.add('delegate-a', 'x');
  buffer.add('delegate-b', 'y');
  assert.equal(nextFrame, 1);
  assert.equal(emitted.length, 0);
  buffer.flush();
  assert.equal(callbacks.size, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].get('delegate-a'), 'x'.repeat(10_000));
  assert.equal(emitted[0].get('delegate-b'), 'y');
  buffer.add('delegate-a', 'z');
  callbacks.get(2)?.();
  assert.equal(emitted[1].get('delegate-a'), 'z');
  buffer.dispose();
});

test('合并委托增量只改变对应消息，保持同一批内 token 顺序', () => {
  const messages = [
    { id: 'a', role: 'assistant', content: 'before-', timestamp: '', _delegateId: 'delegate-a' },
    { id: 'b', role: 'assistant', content: 'other', timestamp: '', _delegateId: 'delegate-b' },
  ] as ChatMessage[];
  const next = mergeDelegateChunks(messages, new Map([['delegate-a', 'one-two']]));
  assert.equal(next[0].content, 'before-one-two');
  assert.equal(next[1], messages[1]);
});

test('同一委托 ID 若在历史中重复，只更新最近的卡片', () => {
  const messages = [
    { id: 'old', role: 'assistant', content: 'old', timestamp: '', _delegateId: 'delegate-a' },
    { id: 'new', role: 'assistant', content: 'new', timestamp: '', _delegateId: 'delegate-a' },
  ] as ChatMessage[];
  const next = mergeDelegateChunks(messages, new Map([['delegate-a', '!']]));
  assert.equal(next[0], messages[0]);
  assert.equal(next[1].content, 'new!');
});
