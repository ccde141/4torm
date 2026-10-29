import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import type { CompactionOptions, CompactionProgress } from './contracts.js';
import { createCompactionCaller } from './controller.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from './policy.js';
import { callPreparedModel } from '../react/model-call.js';
import { providerHttpError } from '../provider-request-error.js';
import { runReActLoopNative } from '../react/native-loop.js';

const success = { content: 'Continue the task', finishReason: 'stop' as const };
const invoke = (caller: ReturnType<typeof createCompactionCaller>, messages: ContextMessage[]) =>
  callPreparedModel(caller, messages, undefined, {});

async function fixture(run: (options: CompactionOptions) => Promise<void>) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compaction-threshold-'));
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
    thresholds: { ...policy.thresholds, monsoon: 1_000 } });
  try { await run({ dataDir, area: 'monsoon', kind: 'conversation', model: 'fixture:model',
    protectedPrefixCount: 1, resolveSummaryBudget: async () => 100_000,
    summarize: async () => 'Verified earlier work.' }); }
  finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

function recentOnly(): ContextMessage[] {
  return [{ role: 'system', content: 'Rules' },
    { role: 'user', origin: 'human', content: 'H'.repeat(8_000) },
    { role: 'assistant', content: 'Evidence '.repeat(12) },
    { role: 'user', origin: 'framework', content: 'Continue the current work' }];
}

function olderHistory(): ContextMessage[] {
  return [{ role: 'system', content: 'Rules' }, ...Array.from({ length: 6 }, (_, index) => [
    { role: 'user' as const, origin: 'human' as const, content: `Direction ${index}` },
    { role: 'assistant' as const, content: 'Evidence '.repeat(100) },
  ]).flat()];
}

test('a protected recent context proceeds without summary calls and becomes compactable as tool work grows', async () => {
  await fixture(async options => {
    const messages = recentOnly(), before = structuredClone(messages);
    let summaries = 0, requests = 0, commits = 0;
    const caller = createCompactionCaller({ ...options,
      summarize: async () => { summaries++; return 'Verified earlier work.'; },
      commit: async () => { commits++; }, llm: { call: async () => { requests++; return success; } } });
    await invoke(caller, messages); await invoke(caller, messages);
    assert.equal(summaries, 0); assert.equal(commits, 0); assert.deepEqual(messages, before);
    messages.push({ role: 'assistant', content: '旧'.repeat(40_000) },
      { role: 'user', origin: 'framework', content: 'Observed old work' },
      { role: 'assistant', content: '近'.repeat(30_000) },
      { role: 'user', origin: 'framework', content: 'Continue' });
    await invoke(caller, messages);
    assert.equal(summaries, 1); assert.equal(commits, 1); assert.equal(requests, 3);
    assert.ok(messages.some(message => message.content === '近'.repeat(30_000)));
  });
});

test('overflow with no older prefix returns the original error without retrying the model', async () => {
  await fixture(async options => {
    const messages = recentOnly(), before = structuredClone(messages);
    let requests = 0;
    const caller = createCompactionCaller({ ...options, llm: { call: async () => {
      requests++; throw providerHttpError(400, '{"error":{"code":"context_length_exceeded"}}');
    } } });
    await assert.rejects(invoke(caller, messages), /模型服务|context_length/);
    assert.equal(requests, 1); assert.deepEqual(messages, before);
  });
});

test('model, archive and commit errors preserve history and do not reach the ordinary request', async () => {
  await fixture(async options => {
    for (const phase of ['model', 'archive', 'commit'] as const) {
      const messages = olderHistory(), before = structuredClone(messages);
      let requests = 0;
      const fail = () => { throw new Error(`fixture ${phase} failure`); };
      const caller = createCompactionCaller({ ...options,
        summarize: async input => {
          if (phase === 'model') fail();
          return 'facts';
        }, archive: async () => { if (phase === 'archive') fail(); },
        commit: async () => { if (phase === 'commit') fail(); },
        llm: { call: async () => { requests++; return success; } } });
      await assert.rejects(invoke(caller, messages), /fixture/);
      assert.equal(requests, 0); assert.deepEqual(messages, before);
    }
  });
});

test('a previous system handoff above the threshold does not trigger repeated summary requests', async () => {
  await fixture(async options => {
    const messages = olderHistory().slice(0, 1).concat(
      [{ role: 'system', content: '[历史压缩记录]\nVerified earlier work.' }], olderHistory().slice(5));
    messages.at(-1)!.content += 'Recent work '.repeat(200);
    const before = structuredClone(messages);
    let requests = 0;
    const caller = createCompactionCaller({ ...options,
      summarize: async () => assert.fail('the previous handoff has no newly eligible work'),
      llm: { call: async () => { requests++; return success; } } });
    await invoke(caller, messages); await invoke(caller, messages);
    assert.equal(requests, 2); assert.deepEqual(messages, before);
  });
});

test('an unchanged public summary is a threshold no-op and never becomes an overflow retry', async () => {
  await fixture(async options => {
    const messages = olderHistory().slice(0, 1).concat(
      [{ role: 'assistant', origin: 'framework', content: '[系统] [会议历史摘要] Verified earlier work.' }],
      olderHistory().slice(5));
    messages.at(-1)!.content += 'Recent work '.repeat(200);
    const before = structuredClone(messages);
    let summaries = 0, requests = 0;
    const caller = createCompactionCaller({ ...options,
      summarize: async input => { summaries++; return input.text; },
      llm: { call: async () => { requests++; return success; } } });
    await invoke(caller, messages); await invoke(caller, messages);
    assert.equal(summaries, 1); assert.equal(requests, 2); assert.deepEqual(messages, before);
    const failing = createCompactionCaller({ ...options,
      summarize: async input => input.text,
      llm: { call: async () => { throw providerHttpError(400, '{"error":{"code":"context_length_exceeded"}}'); } } });
    await assert.rejects(invoke(failing, messages), /未减少/);
    assert.deepEqual(messages, before);
  });
});

test('an ordinary ReAct tool cycle continues once when all previous context is protected', async () => {
  await fixture(async options => {
    const progress: CompactionProgress[] = [];
    let requests = 0, executions = 0;
    const result = await runReActLoopNative({ messages: recentOnly(),
      llm: createCompactionCaller({ ...options,
        summarize: async () => assert.fail('recent history must not be summarized'),
        onProgress: event => { progress.push(event); },
        llm: { call: async () => ++requests === 1
          ? { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'read-once', name: 'read', arguments: '{}' }] }
          : success } }),
      toolDefs: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
      tools: { call: async () => { executions++; return 'Short result'; } } });
    assert.equal(result.termination.status, 'succeeded');
    assert.equal(executions, 1); assert.equal(requests, 2); assert.deepEqual(progress, []);
  });
});
