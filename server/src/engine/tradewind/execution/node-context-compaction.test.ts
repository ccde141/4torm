import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compactMessages } from '../../shared/compaction/index.js';
import { nodeCompactionOptions } from './node-context-compaction.js';
import type { ContextMessage } from '../../shared/types.js';

function history(): ContextMessage[] {
  return [{ role: 'system', content: 'static' },
    { role: 'user', content: '旧任务'.repeat(200) }, { role: 'assistant', content: '旧结果'.repeat(200) },
    { role: 'user', content: '最近任务' }, { role: 'assistant', content: '最近结果' }];
}

test('manual node compaction archives all history, keeping only static instructions and summary', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-full-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const messages = history();
  const original = structuredClone(messages);
  let durable: ContextMessage[] = [];
  const options = nodeCompactionOptions({ dataDir: directory, model: 'test:model',
    scopeKey: directory, archiveDir: path.join(directory, 'bak'), messages,
    persist: async next => { durable = structuredClone(next); }, emit: () => undefined });
  await compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
    resolveSummaryBudget: async () => 10_000,
    summarize: async () => '工作结果摘要' });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, 'static');
  assert.deepEqual(durable, messages);
  const files = await fs.readdir(path.join(directory, 'bak'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'bak', files[0]), 'utf8')), original);
});

test('summary or durable commit failure leaves original node context untouched', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-fail-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const failure of ['summary', 'commit']) {
    const messages = history();
    const original = structuredClone(messages);
    const options = nodeCompactionOptions({ dataDir: directory, model: 'test:model',
      scopeKey: `${directory}:${failure}`, archiveDir: path.join(directory, 'bak'), messages,
      persist: async () => { if (failure === 'commit') throw new Error('IO故障'); }, emit: () => undefined });
    await assert.rejects(compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
      resolveSummaryBudget: async () => 10_000,
      summarize: async () => { if (failure === 'summary') throw new Error('模型故障'); return '真实摘要'; } }));
    assert.deepEqual(messages, original);
  }
});
