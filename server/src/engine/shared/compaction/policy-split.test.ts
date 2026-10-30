import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, loadCompactionPolicy, parseCompactionPolicy, saveCompactionPolicy } from './policy.js';
import { splitCompactionMessages } from './split.js';
import type { ContextMessage } from '../types.js';
import { formatTextToolCall, formatTextToolResult } from '../text-tool-protocol.js';
import { compactionTokenCounter, estimateCompactionTokens } from './estimate.js';

test('policy observes hot updates and rejects corrupt configuration', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compact-policy-'));
  try {
    const initial = await loadCompactionPolicy(dir);
    assert.equal(initial.enabled, false);
    await saveCompactionPolicy(dir, { ...initial, enabled: true,
      thresholds: { ...initial.thresholds, monsoon: 1_000 } });
    assert.equal((await loadCompactionPolicy(dir)).thresholds.monsoon, 1_000);
    await fs.writeFile(path.join(dir, 'compaction-policy.json'), '{bad');
    await assert.rejects(loadCompactionPolicy(dir), SyntaxError);
    await assert.rejects(saveCompactionPolicy(dir, { ...initial, prefixRatio: 1 }), /设置无效/);
    assert.throws(() => parseCompactionPolicy({ ...initial, modelMode: 'fixed' }), /设置无效/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

function history(): ContextMessage[] {
  return [{ role: 'system', content: 'base' }, ...Array.from({ length: 10 }, (_, index) => [
    { role: 'user' as const, origin: 'human' as const, content: `Direction ${index}` },
    { role: 'assistant' as const, content: 'work'.repeat(index === 0 ? 500 : 50) },
  ]).flat()];
}

test('automatic prefix ratio remains token weighted and recent complete turns take priority', () => {
  const messages = history();
  const narrow = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 0.1 });
  const wide = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 0.9 });
  assert.ok(narrow && wide);
  assert.ok(narrow.prefix.length < wide.prefix.length);
  assert.deepEqual(wide.tail, messages.slice(13), 'the four latest human rounds remain intact');
  assert.deepEqual(wide.protected, [messages[0]]);
});

test('pending native groups stay intact but completed oversized groups can enter the summary', () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'base' },
    { role: 'assistant', content: '旧'.repeat(40_000) },
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'file', arguments: '{}' },
      { id: 'b', name: 'file', arguments: '{}' }] },
    { role: 'tool', content: '近'.repeat(30_000), toolCallId: 'a' }];
  let plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 2 / 3 });
  assert.deepEqual(plan?.prefix, [messages[1]]);
  assert.deepEqual(plan?.tail, messages.slice(2));
  messages.push({ role: 'tool', content: 'done', toolCallId: 'b' });
  plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 2 / 3 });
  assert.deepEqual(plan?.tail, []);
  assert.deepEqual(plan?.prefix, messages.slice(1));
});

test('explicit meeting boundaries still protect incomplete records and allow previous summaries to update', () => {
  const messages = history();
  messages.splice(1, 0, { role: 'system', content: 'old summary' });
  const plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 2 / 3,
    protectedPrefixCount: 1, recentHumanTurns: 3, boundaries: () => [4, 8, 12, 16, 20] });
  assert.ok(plan);
  assert.equal(plan.prefix[0].content, 'old summary');
  assert.equal(plan.protected.length + plan.prefix.length, 16);
  assert.deepEqual(plan.tail, messages.slice(16));
});

test('ordinary partial group compaction keeps explicit boundaries when recent rounds fit the allowance', () => {
  const messages = history();
  const boundaries = [5, 9, 13, 17, 21];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 0.01,
    recentHumanTurns: 3, boundaries: () => boundaries });
  assert.ok(plan);
  assert.equal(plan.protected.length + plan.prefix.length, 5);
});

test('text tool protocol and continuation frames do not create artificial human turns', () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'base' },
    { role: 'user', content: 'one real human task', origin: 'human' },
    { role: 'assistant', content: formatTextToolCall('read', {}) },
    { role: 'user', content: formatTextToolResult('read', '旧'.repeat(40_000), true) },
    { role: 'assistant', content: formatTextToolCall('read', {}) },
    { role: 'user', content: formatTextToolResult('read', '近'.repeat(30_000), true) },
    { role: 'assistant', content: 'partial answer' },
    { role: 'user', content: '[System: continuation] continue' }];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 2 / 3 });
  assert.equal(plan?.prefix.at(-1)?.content, messages[3].content);
  assert.deepEqual(plan?.tail, [messages[1], ...messages.slice(4)]);
});

test('a long single ReAct turn can summarize completed older work without truncating recent tool output', () => {
  const call = (id: string): ContextMessage => ({ role: 'assistant', content: '',
    toolCalls: [{ id, name: 'read', arguments: '{}' }] });
  const messages: ContextMessage[] = [{ role: 'system', content: 'base' },
    { role: 'user', content: 'analyze source' }, call('first'),
    { role: 'tool', content: '旧'.repeat(40_000), toolCallId: 'first' }, call('second'),
    { role: 'tool', content: '近'.repeat(30_000), toolCallId: 'second' }];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 2 / 3 });
  assert.equal(plan?.prefix.at(-1)?.toolCallId, 'first');
  assert.deepEqual(plan?.tail, [messages[1], ...messages.slice(4)]);
});

test('a completed oversized final tool result is summarized whole while the human direction remains', () => {
  const human: ContextMessage = { role: 'user', origin: 'human', content: 'Inspect and report, do not write.' };
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' }, human,
    { role: 'assistant', content: '', toolCalls: [{ id: 'large', name: 'read', arguments: '{}' }] },
    { role: 'tool', content: '证'.repeat(100_000), toolCallId: 'large' }];
  for (const mode of ['full', 'partial'] as const) {
    const plan = splitCompactionMessages(messages, { mode, prefixRatio: 2 / 3 });
    assert.deepEqual(plan?.prefix, messages.slice(1));
    assert.deepEqual(plan?.tail, [human]);
    assert.deepEqual(plan?.retainedIndexes, [1]);
    assert.equal(plan?.tail[0], human);
  }
});

test('recent human directions and a bounded suffix retain original order and exact indexes', () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' },
    ...Array.from({ length: 5 }, (_, index) => [
      { role: 'user' as const, origin: 'human' as const, content: `Direction ${index}` },
      { role: 'assistant' as const, content: '证'.repeat(25_000) },
    ]).flat()];
  const plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 1 });
  assert.deepEqual(plan?.retainedIndexes, [3, 5, 7, 9, 10]);
  assert.deepEqual(plan?.tail, [messages[3], messages[5], messages[7], ...messages.slice(9)]);
  assert.ok(plan?.tail.every((message, index) => message === messages[plan.retainedIndexes![index]]));
  assert.equal(plan?.prefix.at(-1), messages[8]);
});

test('partial compaction preserves the configured ratio rather than forcing the whole tail below thirty thousand', () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' },
    { role: 'user', origin: 'human', content: 'Continue the project' },
    ...Array.from({ length: 12 }, (_, index) => ({ role: 'assistant' as const,
      content: `${index}:` + '证'.repeat(10_000) }))];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 2 / 3 });
  assert.equal(plan?.prefix.length, 9);
  assert.deepEqual(plan?.retainedIndexes, [1, 10, 11, 12, 13]);
  assert.deepEqual(plan?.tail, [messages[1], ...messages.slice(10)]);
});

test('an oversized completed group round may split at a safe reply before the streaming barrier', () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' },
    { role: 'user', origin: 'human', content: 'Discuss the evidence' },
    { role: 'user', origin: 'framework', content: '甲'.repeat(20_000) },
    { role: 'user', origin: 'framework', content: '乙'.repeat(20_000) },
    { role: 'user', origin: 'framework', content: 'Still streaming' }];
  const plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 1,
    recentHumanTurns: 3, boundaries: () => [4] });
  assert.deepEqual(plan?.prefix, messages.slice(1, 3));
  assert.deepEqual(plan?.retainedIndexes, [1, 3, 4]);
  assert.deepEqual(plan?.tail, [messages[1], messages[3], messages[4]]);
  const streamingOnly = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 1,
    recentHumanTurns: 3, boundaries: () => [] });
  assert.equal(streamingOnly, null);
});

test('oversized human input is summarized whole without truncating or retaining it beyond the allowance', () => {
  const human: ContextMessage = { role: 'user', origin: 'human', content: '人'.repeat(40_000) };
  const reply: ContextMessage = { role: 'assistant', content: 'Completed evidence' };
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' }, human, reply];
  const plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 1 });
  assert.deepEqual(plan?.prefix, [human]);
  assert.equal(plan?.prefix[0], human);
  assert.deepEqual(plan?.tail, [reply]);
  assert.deepEqual(plan?.retainedIndexes, [2]);
});

test('recent retention counts only the active global tool-image allowance', () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' },
    { role: 'user', origin: 'human', content: 'Inspect the screenshots and report' },
    ...Array.from({ length: 50 }, (_, index) => [
      { role: 'assistant' as const, content: '',
        toolCalls: [{ id: String(index), name: 'inspect', arguments: '{}' }] },
      { role: 'tool' as const, content: '证'.repeat(600), toolCallId: String(index),
        toolImages: [{ id: `image-${index}`, name: 'screenshot.png', mimeType: 'image/png', size: 100 }] },
    ]).flat()];
  const countTokens = compactionTokenCounter(messages);
  assert.equal(compactionTokenCounter(messages, [1])(8), estimateCompactionTokens([messages[1], ...messages.slice(8)]));
  assert.equal(countTokens(1, 40), estimateCompactionTokens(messages.slice(1, 40)));
  const plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 1 });
  assert.ok(plan);
  assert.ok(plan.tail.filter(message => message.role === 'tool').length > 40);
  assert.ok(estimateCompactionTokens(plan.tail) <= 30_000);
});
