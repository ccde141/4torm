import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleContext } from '../../i18n/locale-context';
import { resolveMessage, type Locale } from '../../i18n/locale';
import { memoryRecallLabel, memoryReferencesByHuman, type MemoryReference } from './memory-references';
import MemoryRecallPreview from './MemoryRecallPreview';
import type { ChatMessage, NativeContextMessage } from '../../types';

const source: MemoryReference = { id: 'memory:sample', revision: 'v1', title: '星湾列表', text: '每页24条', level: 'L2', kind: 'memory', scope: '星湾' };
const reference = (records: unknown[] = [source]): NativeContextMessage => ({ role: 'user', origin: 'framework',
  content: '[框架记忆参考]\n' + JSON.stringify({ records }) });
const human: ChatMessage = { id: 'human', role: 'user', content: '列表怎么做？', timestamp: 'now' };
const answer = (nativeContext: NativeContextMessage[]): ChatMessage => ({ id: 'answer', role: 'assistant', content: '', timestamp: 'now', nativeContext });

test('only grounded framework references attach above their human message, including after a reload', () => {
  const messages = [human, answer([reference(), reference()])];
  assert.equal(memoryReferencesByHuman(messages).get('human')?.length, 1);
  assert.deepEqual([...memoryReferencesByHuman(JSON.parse(JSON.stringify(messages)))], [...memoryReferencesByHuman(messages)]);
  assert.equal(memoryReferencesByHuman([human, answer([{ ...reference(), origin: 'human' }])]).size, 0);
  assert.equal(memoryReferencesByHuman([human, answer([reference([{ title: 'candidate only' }])])]).size, 0);
});

test('steering recall attaches to the matching included input without moving earlier references', () => {
  const message = { ...answer([reference(), { role: 'user' as const, origin: 'human' as const, content: '改一下' },
    reference([{ ...source, id: 'memory:other', title: '修改约定' }])]), humanInputs: [
    { id: 'steering', content: '改一下', runId: 'answer', sequence: 1, receivedAt: 'now', state: 'included' as const } ] };
  const indexed = memoryReferencesByHuman([human, message]);
  assert.equal(indexed.get('human')?.[0].title, '星湾列表');
  assert.equal(indexed.get('steering')?.[0].title, '修改约定');
});

test('the preview retains two Level 1 and six Level 2 sources and merges additional excerpts', () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({ ...source, id: `memory:large-${i}`,
    level: i < 2 ? 'L1' as const : 'L2' as const, text: `entry ${i} `.repeat(400) }));
  const extra = { ...sources[2], text: 'Additional verified progress and remaining work.' };
  const indexed = memoryReferencesByHuman([human, answer([reference(sources), reference([extra])])]);
  assert.equal(indexed.get(human.id)?.length, 8);
  const combined = indexed.get(human.id)?.find(item => item.id === extra.id);
  assert.ok(combined?.text.includes(sources[2].text)); assert.ok(combined?.text.includes(extra.text));
});

test('streaming a later turn reuses old recall parsing and still handles changed human ownership', () => {
  let reads = 0;
  const item = reference();
  const entry = { ...item, get content() { reads++; return item.content; } };
  const old = answer([entry]);
  const initial = memoryReferencesByHuman([human, old]);
  const parsed = reads;
  const later = { ...answer([]), id: 'later' };
  assert.deepEqual(memoryReferencesByHuman([human, old, later]).get(human.id), initial.get(human.id));
  assert.equal(reads, parsed, 'unchanged historical context is not rescanned on a stream update');
  assert.equal(memoryReferencesByHuman([{ ...human, id: 'edited-human' }, old]).get('edited-human')?.length, 1);
  assert.ok(reads > parsed);
  const revised = { ...old, nativeContext: [reference([{ ...source, title: 'Updated source' }])] };
  assert.equal(memoryReferencesByHuman([human, revised]).get(human.id)?.[0].title, 'Updated source');
});

test('preview is compact, bilingual and renders source content as text', () => {
  function render(locale: Locale) {
    return renderToStaticMarkup(createElement(LocaleContext.Provider, { value: { locale, setLocale: () => {},
      t: (key, values) => resolveMessage(locale, key, values) } }, createElement(MemoryRecallPreview, { messageId: 'human', sources: [{ ...source, text: '<script>bad()</script>' }] })));
  }
  const zh = render('zh-CN'), en = render('en-US');
  assert.match(zh, /aria-expanded="false"/); assert.match(zh, /aria-controls=/);
  assert.match(zh, /aria-hidden="true" inert=""/); assert.doesNotMatch(zh, /<script>/);
  assert.ok(zh.includes(resolveMessage('zh-CN', memoryRecallLabel('human'))));
  assert.match(zh, /L2 · 模型精选/); assert.match(zh, /&lt;script&gt;/);
  assert.ok(en.includes(resolveMessage('en-US', memoryRecallLabel('human')))); assert.match(en, /Saved memory/);
});

test('recall wording varies across messages and stays stable for the same message', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `human-message-${index}`);
  const labels = ids.map(memoryRecallLabel);
  assert.deepEqual(new Set(labels), new Set(['recall.used', 'recall.thisRecall']));
  assert.deepEqual(ids.map(memoryRecallLabel), labels);
  assert.deepEqual([...new Set(labels.map(key => resolveMessage('zh-CN', key)))].sort(), ['本次回忆', '相关记忆'].sort());
});
