import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../../i18n/LocaleContext';
import { appendMeetingCompaction, splitMeetingCompactions, meetingPublicStreamSnapshot } from './meeting-compaction';
import type { MeetingMessage } from './meeting-client';

registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context);
} });
const { MeetingMessageItem } = await import('./MeetingMessageItem');
const { default: MeetingChairMessageItem } = await import('./MeetingChairMessageItem');

test('meeting presentation splits a persisted turn with exact text, tools and reasoning and keeps identities immutable', () => {
  const message: MeetingMessage = { speaker: '研究工位', content: '最终答复', rawContent: '前段后段', reasoning: '前思考后思考',
    timestamp: 1, streaming: true, toolCalls: [{ tool: 'read_file', args: {}, result: 'old', status: 'done' },
      { tool: 'write_file', args: {}, result: 'new', status: 'done' }],
    compactions: [{ id: 'compact-meeting', summary: '交接', textOffset: 2, toolOffset: 1, reasoningOffset: 3 }] };
  const original = structuredClone(message);
  const parts = splitMeetingCompactions(message);
  assert.deepEqual(parts.map(part => part.message.content), ['前段', '后段']);
  assert.deepEqual(parts.map(part => part.message.reasoning), ['前思考', '后思考']);
  assert.deepEqual(parts.map(part => part.message.toolCalls?.length), [1, 1]);
  assert.deepEqual(parts.map(part => part.message.streaming), [false, true]);
  assert.equal(appendMeetingCompaction(message, message.compactions![0]), message);
  assert.deepEqual(message, original);
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(MeetingMessageItem, { msg: JSON.parse(JSON.stringify(message)) as MeetingMessage })));
  assert.equal((html.match(/class="tw-meeting-msg"/g) ?? []).length, 2);
  assert.equal((html.match(/上下文已压缩 · 查看交接/g) ?? []).length, 1);
  assert.match(html, /已接续/);
  assert.equal((html.match(/前段/g) ?? []).length, 1);
  assert.equal((html.match(/后段/g) ?? []).length, 1);
});

test('multiple meeting boundaries remain independent after reload and never invent a human input', () => {
  const message: MeetingMessage = { speaker: '工位', content: 'ABC', reasoning: 'xyz', timestamp: 1,
    compactions: [{ id: 'first', summary: 'one', toolOffset: 0, textOffset: 1, reasoningOffset: 1 },
      { id: 'second', summary: 'two', toolOffset: 0, textOffset: 2, reasoningOffset: 2 }] };
  const parts = splitMeetingCompactions(JSON.parse(JSON.stringify(message)) as MeetingMessage);
  assert.deepEqual(parts.map(part => part.message.content), ['A', 'B', 'C']);
  assert.ok(parts.every(part => part.message.speaker === '工位'));
  const legacy = { ...message, compactions: undefined };
  assert.equal(splitMeetingCompactions(legacy)[0].message, legacy);
});

test('meeting chair reasoning and text follow the same divider pattern with standalone manual markers', () => {
  const message = { role: 'assistant', content: 'beforeafter', reasoningContent: 'oldnew',
    compactions: [{ id: 'chair', summary: 'handoff', textOffset: 6, toolOffset: 0, reasoningOffset: 3 }] };
  const html = renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(MeetingChairMessageItem, { message, index: 0, busy: false })));
  assert.equal((html.match(/class="tw-meeting-msg tw-meeting-msg--assistant"/g) ?? []).length, 2);
  assert.equal((html.match(/上下文已压缩 · 查看交接/g) ?? []).length, 1);
  assert.ok(html.indexOf('before') < html.indexOf('上下文已压缩'));
  assert.ok(html.indexOf('after') > html.indexOf('上下文已压缩'));
});

test('restored meeting streams continue from the same raw text, reasoning and tool coordinates', () => {
  const message: MeetingMessage = { speaker: '工位', content: '最终呈现', rawContent: '压缩前', reasoning: '旧思考',
    timestamp: 1, streaming: true, toolCalls: [{ tool: 'read_file', args: {}, result: 'old', status: 'done' }],
    compactions: [{ id: 'restored', summary: '交接', textOffset: 3, toolOffset: 1, reasoningOffset: 3 }] };
  const stream = meetingPublicStreamSnapshot([message]);
  assert.equal(stream.currentLabel, '工位');
  assert.equal(stream.streamContent, '压缩前');
  stream.streamContent += '接续';
  stream.reasoningContent += '新思考';
  const parts = splitMeetingCompactions({ ...message, rawContent: stream.streamContent, reasoning: stream.reasoningContent });
  assert.deepEqual(parts.map(part => part.message.content), ['压缩前', '接续']);
  assert.deepEqual(parts.map(part => part.message.reasoning), ['旧思考', '新思考']);
  assert.deepEqual(parts.map(part => part.message.toolCalls?.length), [1, 0]);
  assert.equal(meetingPublicStreamSnapshot([{ ...message, streaming: false }]).currentLabel, '');
});
