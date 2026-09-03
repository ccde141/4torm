import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  compactIfNeeded,
  compactMeetingIfNeeded,
  type MeetingMessage,
} from './context-compactor.js';
import type { ContextMessage } from '../../shared/types.js';

function agentMessages(): ContextMessage[] {
  return [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'one' }, { role: 'assistant', content: 'answer one' },
    { role: 'user', content: 'two' }, { role: 'assistant', content: 'answer two' },
    { role: 'user', content: 'three' }, { role: 'assistant', content: 'answer three' },
    { role: 'user', content: 'four' }, { role: 'assistant', content: 'answer four' },
  ];
}

function meetingMessages(): MeetingMessage[] {
  return [
    { speaker: '人类', content: 'one', timestamp: 1 },
    { speaker: 'A', content: 'answer one', timestamp: 2 },
    { speaker: '人类', content: 'two', timestamp: 3 },
    { speaker: 'A', content: 'answer two', timestamp: 4 },
    { speaker: '人类', content: 'three', timestamp: 5 },
    { speaker: 'A', content: 'answer three', timestamp: 6 },
  ];
}

test('Tradewind agent compaction stops before summarizing when archive preparation fails', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-compact-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const blocked = path.join(dir, 'blocked');
  await fs.writeFile(blocked, 'file');
  const messages = agentMessages();
  const before = structuredClone(messages);
  const state = { disabled: false, archiveSeq: 0 };
  let summaries = 0;

  const compacted = await compactIfNeeded(messages, 100, state, {
    dataDir: dir, model: 'test:model', threshold: 100,
    archiveDir: path.join(blocked, 'bak'),
    summarize: async () => { summaries += 1; return 'summary'; },
  });

  assert.equal(compacted, false);
  assert.equal(summaries, 0);
  assert.equal(state.archiveSeq, 0);
  assert.deepEqual(messages, before);
});

test('Tradewind meeting compaction commits archive and summary exactly once', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-meeting-compact-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const messages = meetingMessages();
  const state = { disabled: false, archiveSeq: 0 };
  let summaries = 0;

  const compacted = await compactMeetingIfNeeded(messages, 100, state, {
    dataDir: dir, model: 'test:model', threshold: 100,
    archiveDir: path.join(dir, 'bak'),
    summarize: async () => { summaries += 1; return 'stable summary'; },
  }, ['A']);

  assert.equal(compacted, true);
  assert.equal(summaries, 1);
  assert.equal(state.archiveSeq, 1);
  assert.match(messages[0]?.content || '', /stable summary/);
  assert.equal((await fs.readdir(path.join(dir, 'bak'))).length, 1);
});

test('Tradewind summary failure is not retried and leaves active history unchanged', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-summary-fail-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const messages = agentMessages();
  const before = structuredClone(messages);
  const state = { disabled: false, archiveSeq: 0 };
  let summaries = 0;

  const compacted = await compactIfNeeded(messages, 100, state, {
    dataDir: dir, model: 'test:model', threshold: 100,
    archiveDir: path.join(dir, 'bak'),
    summarize: async () => { summaries += 1; throw new Error('summary failed'); },
  });

  assert.equal(compacted, false);
  assert.equal(summaries, 1);
  assert.equal(state.disabled, true);
  assert.deepEqual(messages, before);
});
