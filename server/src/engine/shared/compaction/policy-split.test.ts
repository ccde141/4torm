import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, loadCompactionPolicy, parseCompactionPolicy, saveCompactionPolicy } from './policy.js';
import { splitCompactionMessages } from './split.js';
import type { ContextMessage } from '../types.js';
import { formatTextToolCall, formatTextToolResult } from '../text-tool-protocol.js';

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

test('native calls retain all tool results even when the thirty-thousand-token edge falls inside the group', () => {
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
  assert.deepEqual(plan?.tail, messages.slice(2));
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
  assert.deepEqual(plan?.tail, messages.slice(4));
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
  assert.deepEqual(plan?.tail, messages.slice(4));
});
