import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../../shared/types.js';
import { NodeDisplayHistory, readNodeDisplayHistory } from './node-display-history.js';

test('display checkpoints retain raw work and reasoning while only matching model commits activate boundaries', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-display-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source: ContextMessage[] = [{ role: 'system', content: 'identity' },
    { role: 'user', content: 'original human request' },
    { role: 'assistant', content: 'before', reasoningContent: 'original reasoning',
      toolCalls: [{ id: 'call-a', name: 'read', arguments: '{}' }] },
    { role: 'tool', content: 'original evidence', toolCallId: 'call-a' }];
  const next: ContextMessage[] = [{ role: 'system', content: 'identity' },
    { role: 'system', content: '[历史压缩记录]\nhandoff' }, source[1]];
  const display = new NodeDisplayHistory(directory);
  const commit = await display.stage(source, next, { id: 'compact-one', summary: 'handoff' });
  assert.equal((await readNodeDisplayHistory(directory, source)).some(message => message.compaction), false);
  commit();
  const restored = await readNodeDisplayHistory(directory, next);
  assert.equal(restored.find(message => message.reasoningContent)?.reasoningContent, 'original reasoning');
  assert.equal(restored.flatMap(message => message.toolSteps ?? [])[0].result, 'original evidence');
  assert.deepEqual(restored.at(-1)?.compaction, { id: 'compact-one', summary: 'handoff' });
  assert.deepEqual(display.messages(next), restored);
  const continuing = [...next, { role: 'assistant' as const, content: 'after' }];
  assert.equal(display.messages(continuing).filter(message => message.content === 'after').length, 1);
  const second: ContextMessage[] = [next[0], { role: 'system', content: '[历史压缩记录]\nsecond' }, source[1]];
  const restarted = new NodeDisplayHistory(directory);
  const commitSecond = await restarted.stage(continuing, second, { id: 'compact-two', summary: 'second' });
  // A failed model write leaves the old committed display selected from the same sidecar.
  assert.deepEqual(await readNodeDisplayHistory(directory, continuing), display.messages(continuing));
  commitSecond();
  assert.equal(restarted.messages(second).filter(message => message.compaction).length, 2);
  assert.equal((await readNodeDisplayHistory(directory, second)).filter(message => message.content === 'before').length, 1);
  assert.ok(!second.some(message => message.content === 'original evidence'));
});

test('a missing display sidecar uses legacy model history and damaged storage remains an error', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-display-damaged-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const context: ContextMessage[] = [{ role: 'system', content: 'identity' }, { role: 'user', content: 'request' }];
  assert.deepEqual(await readNodeDisplayHistory(directory, context), [{ role: 'user', content: 'request' }]);
  await fs.writeFile(path.join(directory, 'display-history.json'), '{broken');
  await assert.rejects(readNodeDisplayHistory(directory, context), SyntaxError);
  assert.equal(await fs.readFile(path.join(directory, 'display-history.json'), 'utf8'), '{broken');
});

test('an uncommitted context prefix cannot activate a successful display boundary', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-display-prefix-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const before: ContextMessage[] = [{ role: 'system', content: 'identity' },
    { role: 'system', content: '[历史压缩记录]\nsame summary' },
    { role: 'user', content: 'same human request' }, { role: 'assistant', content: 'new tool evidence' }];
  const next = before.slice(0, 3);
  const original = structuredClone(before);
  const display = new NodeDisplayHistory(directory);
  await display.stage(before, next, { id: 'uncommitted', summary: 'same summary' });
  assert.deepEqual(before, original, 'staging must not mutate the source checkpoint through shared message references');
  assert.equal((await readNodeDisplayHistory(directory, before)).some(message => message.compaction), false);
  assert.equal((await readNodeDisplayHistory(directory, next)).at(-1)?.compaction?.id, 'uncommitted');
});
