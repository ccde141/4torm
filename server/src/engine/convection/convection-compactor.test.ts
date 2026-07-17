import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compactConvectionIfNeeded,
  CONVECTION_COMPACT_THRESHOLD,
  type ConvectionMessage,
} from './convection-compactor.js';

function messages(): ConvectionMessage[] {
  return [
    { speaker: '人类', content: '一', timestamp: 1 },
    { speaker: 'A', content: '答一', timestamp: 2 },
    { speaker: '人类', content: '二', timestamp: 3 },
    { speaker: 'A', content: '答二', timestamp: 4 },
    { speaker: '人类', content: '三', timestamp: 5 },
    { speaker: 'A', content: '答三', timestamp: 6 },
    { speaker: '人类', content: '四', timestamp: 7 },
    { speaker: 'A', content: '答四', timestamp: 8 },
  ];
}

test('归档失败时不摘要、不修改消息、不推进序号', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-compact-'));
  const blocked = path.join(dir, 'blocked');
  await fs.writeFile(blocked, 'file');
  const publicMessages = messages();
  const before = structuredClone(publicMessages);
  const state = { disabled: false, archiveSeq: 0 };
  let summarizeCalls = 0;

  const compacted = await compactConvectionIfNeeded(
    publicMessages,
    CONVECTION_COMPACT_THRESHOLD,
    state,
    {
      dataDir: dir,
      chairModel: 'test:model',
      archiveDir: path.join(blocked, 'bak'),
      participants: ['A'],
      summarize: async () => { summarizeCalls++; return '摘要'; },
    },
  );

  assert.equal(compacted, false);
  assert.equal(summarizeCalls, 0);
  assert.equal(state.archiveSeq, 0);
  assert.deepEqual(publicMessages, before);
});

test('摘要失败时保留归档和原消息并禁用后续压缩', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-compact-'));
  const publicMessages = messages();
  const before = structuredClone(publicMessages);
  const state = { disabled: false, archiveSeq: 0 };

  const compacted = await compactConvectionIfNeeded(
    publicMessages,
    CONVECTION_COMPACT_THRESHOLD,
    state,
    {
      dataDir: dir,
      chairModel: 'test:model',
      archiveDir: path.join(dir, 'bak'),
      participants: ['A'],
      summarize: async () => { throw new Error('summary failed'); },
    },
  );

  assert.equal(compacted, false);
  assert.equal(state.disabled, true);
  assert.equal(state.archiveSeq, 1);
  assert.deepEqual(publicMessages, before);
  assert.equal((await fs.readdir(path.join(dir, 'bak'))).length, 1);
});

test('归档与摘要都成功后才替换历史消息', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-compact-'));
  const publicMessages = messages();
  const state = { disabled: false, archiveSeq: 0 };
  const events: string[] = [];

  const compacted = await compactConvectionIfNeeded(
    publicMessages,
    CONVECTION_COMPACT_THRESHOLD,
    state,
    {
      dataDir: dir,
      chairModel: 'test:model',
      archiveDir: path.join(dir, 'bak'),
      participants: ['A'],
      summarize: async () => '稳定摘要',
      onEvent: event => { events.push(event.type); },
    },
  );

  assert.equal(compacted, true);
  assert.equal(state.archiveSeq, 1);
  assert.equal(publicMessages[0].speaker, '系统');
  assert.match(publicMessages[0].content, /稳定摘要/);
  assert.deepEqual(events, ['compact-start', 'compact-done']);
  const archived = JSON.parse(await fs.readFile(path.join(dir, 'bak', '001.json'), 'utf8'));
  assert.equal(archived.length, 4);
});
