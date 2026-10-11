import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, loadCompactionPolicy, parseCompactionPolicy, saveCompactionPolicy } from './policy.js';
import { splitCompactionMessages } from './split.js';
import { serializeCompactionMessages } from './estimate.js';
import type { ContextMessage } from '../types.js';
import { formatTextToolCall, formatTextToolResult } from '../text-tool-protocol.js';

test('policy observes hot updates; corrupt configuration is never mistaken for a disabled setting', async () => {
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

test('partial compaction follows token weight rather than number of turns and keeps latest request', () => {
  const messages: ContextMessage[] = [
    { role: 'system', content: 'base' },
    { role: 'user', content: 'large '.repeat(1_000) },
    { role: 'assistant', content: 'done' },
    { role: 'user', content: 'small' }, { role: 'assistant', content: 'done' },
    { role: 'user', content: 'latest' },
  ];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 2 / 3 });
  assert.equal(plan?.prefix.length, 2);
  assert.deepEqual(plan?.protected, [messages[0]]);
  assert.equal(plan?.tail.at(-1)?.content, 'latest');
});

test('a native assistant tool call and all results stay together, including unfinished calls', () => {
  const messages: ContextMessage[] = [
    { role: 'system', content: 'base' }, { role: 'user', content: 'earlier' },
    { role: 'assistant', content: 'done' }, { role: 'user', content: 'working' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'file', arguments: '{}' },
      { id: 'b', name: 'file', arguments: '{}' }] },
    { role: 'tool', content: 'ok', toolCallId: 'a' },
  ];
  const plan = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 2 / 3 });
  assert.deepEqual(plan?.prefix, messages.slice(1, 3));
  assert.deepEqual(plan?.tail, messages.slice(3));
  messages.push({ role: 'tool', content: 'ok', toolCallId: 'b' });
  const full = splitCompactionMessages(messages, { mode: 'full', prefixRatio: 2 / 3 });
  assert.equal(full?.tail.length, 0);
  assert.match(serializeCompactionMessages(full!.prefix), /工具调用 b file/);
  assert.match(serializeCompactionMessages(full!.prefix), /工具结果 a/);
});

test('meeting boundaries preserve round units; previous summary is compactable when only static prefix protected', () => {
  const messages: ContextMessage[] = [
    { role: 'system', content: 'base' }, { role: 'system', content: 'old summary' },
    { role: 'user', content: 'round1' }, { role: 'assistant', content: 'position1' },
    { role: 'assistant', content: 'position2' }, { role: 'user', content: 'round2' },
  ];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 2 / 3,
    protectedPrefixCount: 1, boundaries: () => [5, 6] });
  assert.deepEqual(plan?.prefix, messages.slice(1, 5));
  assert.deepEqual(plan?.tail, [messages[5]]);
  assert.equal(defaultCompactionPolicy().version, 1);
});

test('text tool results and continuation instructions are not new human turns', () => {
  const messages: ContextMessage[] = [
    { role: 'system', content: 'base' }, { role: 'user', content: 'earlier' },
    { role: 'assistant', content: 'done' }, { role: 'user', content: 'working' },
    { role: 'assistant', content: formatTextToolCall('read', {}) },
    { role: 'user', content: formatTextToolResult('read', 'result', true) },
    { role: 'assistant', content: 'partial answer' },
    { role: 'user', content: '[System: continuation] continue' },
  ];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 2 / 3 });
  assert.equal(plan?.prefix.at(-1)?.content, formatTextToolResult('read', 'result', true));
  assert.deepEqual(plan?.tail, messages.slice(6));
});

test('completed earlier tool groups can compact inside a single long ReAct turn', () => {
  const call = (id: string): ContextMessage => ({ role: 'assistant', content: '',
    toolCalls: [{ id, name: 'read', arguments: '{}' }] });
  const messages: ContextMessage[] = [{ role: 'system', content: 'base' },
    { role: 'user', content: 'analyze source' }, call('first'),
    { role: 'tool', content: 'older result'.repeat(500), toolCallId: 'first' }, call('second'),
    { role: 'tool', content: 'latest result', toolCallId: 'second' }];
  const plan = splitCompactionMessages(messages, { mode: 'partial', prefixRatio: 2 / 3 });
  assert.equal(plan?.prefix.at(-1)?.toolCallId, 'first');
  assert.deepEqual(plan?.tail, messages.slice(4));
});
