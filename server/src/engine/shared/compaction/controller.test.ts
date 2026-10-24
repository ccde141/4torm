import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import type { LLMCaller } from '../react/native-loop.js';
import { providerHttpError } from '../provider-request-error.js';
import { compactMessages, createCompactionCaller } from './controller.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from './policy.js';
import type { CompactionOptions, CompactionPolicy } from './contracts.js';
import { estimateCompactionTokens } from './estimate.js';
import { callPreparedModel } from '../react/model-call.js';

const invoke = (caller: LLMCaller, messages: ContextMessage[]) => callPreparedModel(caller, messages, undefined, {});

async function fixture(run: (options: CompactionOptions, policy: CompactionPolicy) => Promise<void>) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compact-controller-'));
  const policy = defaultCompactionPolicy();
  const options: CompactionOptions = { dataDir, area: 'monsoon', kind: 'conversation', model: 'p:current',
    protectedPrefixCount: 1, resolveSummaryBudget: async () => 16_000, summarize: async () => 'facts' };
  try { await run(options, policy); } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

function history(): ContextMessage[] {
  return [{ role: 'system', content: 'static rules' },
    { role: 'user', content: 'a'.repeat(3_000) }, { role: 'assistant', content: 'b'.repeat(3_000) },
    { role: 'user', content: 'c'.repeat(2_000) }, { role: 'assistant', content: 'done' },
    { role: 'user', content: 'latest input' }];
}
const success = { content: 'answer', finishReason: 'stop' as const };
const overflow = () => providerHttpError(400, '{"error":{"code":"context_length_exceeded","message":"context too long"}}');

test('durable archive precedes summary and commit; manual compaction covers all history', async () => {
  await fixture(async options => {
    const messages = history();
    messages.pop();
    const order: string[] = [];
    const plan = await compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
      archive: async () => { order.push('archive'); },
      summarize: async () => { order.push('summary'); return 'facts'; },
      commit: async pending => { order.push('commit'); assert.equal(messages.length, 5);
        assert.equal(pending.tail.length, 0); } });
    assert.deepEqual(order, ['archive', 'summary', 'commit']);
    assert.equal(plan!.prefix.length, 4);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].content, 'static rules');
  });
});

test('short summaries cannot increase live context through summary framing overhead', async () => {
  await fixture(async options => {
    const messages: ContextMessage[] = [{ role: 'system', content: 'static' },
      { role: 'user', content: 'a'.repeat(24) }];
    const before = structuredClone(messages);
    let commits = 0;
    await assert.rejects(compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
      summarize: async () => 'short', commit: async () => { commits++; } }), /未减少/);
    assert.equal(commits, 0);
    assert.deepEqual(messages, before);
  });
});

test('archive and commit failures never fall back a model or mutate active history', async () => {
  await fixture(async (options, policy) => {
    policy.fixedModel = 'p:fixed'; policy.modelMode = 'fixed';
    await saveCompactionPolicy(options.dataDir, policy);
    for (const stage of ['archive', 'commit'] as const) {
      const messages = history(); const before = structuredClone(messages); let summaries = 0;
      await assert.rejects(compactMessages({ ...options, messages, mode: 'partial', reason: 'manual',
        archive: async () => { if (stage === 'archive') throw new Error('disk full'); },
        summarize: async () => { summaries++; return 'facts'; },
        commit: async () => { throw new Error('revision changed'); } }),
      stage === 'archive' ? /disk full/ : /revision changed/);
      assert.deepEqual(messages, before);
      assert.equal(summaries, stage === 'archive' ? 0 : 1);
    }
  });
});

test('fixed/current fallback is one alternate model, with awaited failure notice', async () => {
  await fixture(async (options, policy) => {
    policy.fixedModel = 'p:fixed'; policy.modelMode = 'fixed';
    await saveCompactionPolicy(options.dataDir, policy);
    const calls: string[] = []; const order: string[] = [];
    await compactMessages({ ...options, messages: history(), mode: 'partial', reason: 'manual',
      summarize: async input => { calls.push(input.model); order.push(input.model);
        if (input.model === 'p:fixed') throw new Error('offline'); return 'facts'; },
      onNotice: async notice => { await Promise.resolve(); order.push('notice');
        assert.equal(notice.fallbackModel, 'p:current'); } });
    assert.deepEqual(calls, ['p:fixed', 'p:current']);
    assert.deepEqual(order, ['p:fixed', 'notice', 'p:current']);
    policy.modelMode = 'current'; await saveCompactionPolicy(options.dataDir, policy);
    calls.length = 0;
    await compactMessages({ ...options, messages: history(), mode: 'partial', reason: 'manual',
      summarize: async input => { calls.push(input.model);
        if (input.model === 'p:current') throw new Error('offline'); return 'facts'; } });
    assert.deepEqual(calls, ['p:current', 'p:fixed']);
  });
});

test('meeting always uses chair prompt and chair model, fixed model is its only alternate', async () => {
  await fixture(async (options, policy) => {
    policy.fixedModel = 'p:fixed'; policy.modelMode = 'fixed';
    await saveCompactionPolicy(options.dataDir, policy);
    const calls: string[] = [];
    await compactMessages({ ...options, kind: 'meeting', chairModel: 'p:chair', prompt: 'chair-specific',
      messages: history(), mode: 'full', reason: 'manual', summarize: async input => {
        calls.push(input.model); assert.match(input.prompt, /chair-specific/);
        assert.match(input.prompt, /不能把缺席/);
        if (input.model === 'p:chair') throw new Error('offline'); return 'positions';
      } });
    assert.deepEqual(calls, ['p:chair', 'p:fixed']);
    calls.length = 0;
    await assert.rejects(compactMessages({ ...options, kind: 'meeting', chairModel: 'p:fixed',
      messages: history(), mode: 'full', reason: 'manual', summarize: async input => {
        calls.push(input.model); throw new Error('offline');
      } }), /offline/);
    assert.deepEqual(calls, ['p:fixed']);
  });
});

test('hot threshold increase cancels old trigger; lowering takes effect next boundary', async () => {
  await fixture(async (options, policy) => {
    policy.enabled = true; policy.thresholds.monsoon = 1_000;
    await saveCompactionPolicy(options.dataDir, policy);
    let compacted = 0;
    const caller = createCompactionCaller({ ...options, initialPromptTokens: 800,
      llm: { call: async () => ({ ...success, usage: { promptTokens: 1_200, completionTokens: 10, totalTokens: 1_210 } }) },
      commit: async () => { compacted++; } });
    const messages = history();
    await invoke(caller, messages); assert.equal(compacted, 0);
    policy.thresholds.monsoon = 3_000; await saveCompactionPolicy(options.dataDir, policy);
    await invoke(caller, messages); assert.equal(compacted, 0);
    policy.thresholds.monsoon = 1_000; await saveCompactionPolicy(options.dataDir, policy);
    await invoke(caller, messages); assert.equal(compacted, 1);
  });
});

test('newly appended large human input is counted before its first model request', async () => {
  await fixture(async (options, policy) => {
    policy.enabled = true; policy.thresholds.monsoon = 3_000;
    await saveCompactionPolicy(options.dataDir, policy);
    const active = history();
    active.pop();
    const priorEstimate = estimateCompactionTokens(active);
    active.push({ role: 'user', content: 'new input '.repeat(600) });
    let compacted = false;
    const caller = createCompactionCaller({ ...options, initialPromptTokens: 2_000,
      initialEstimateTokens: priorEstimate,
      commit: async () => { compacted = true; },
      llm: { call: async () => { assert.equal(compacted, true); return success; } } });
    await invoke(caller, active);
  });
});

test('only context overflow retries failed request once; no general provider retry', async () => {
  await fixture(async options => {
    let calls = 0; let summaries = 0;
    const llm: LLMCaller = { call: async () => { if (++calls === 1) throw overflow(); return success; } };
    const caller = createCompactionCaller({ ...options, llm,
      summarize: async () => { summaries++; return 'facts'; } });
    await invoke(caller, history());
    assert.equal(calls, 2); assert.equal(summaries, 1);
    calls = 0;
    const failing = createCompactionCaller({ ...options, llm: { call: async () => { calls++; throw overflow(); } } });
    await assert.rejects(invoke(failing, history()), /模型服务确认/);
    assert.equal(calls, 2);
    calls = 0;
    const invalid = createCompactionCaller({ ...options, llm: { call: async () => {
      calls++; throw providerHttpError(400, '{"error":{"message":"invalid tools"}}');
    } } });
    await assert.rejects(invoke(invalid, history()), /invalid tools/);
    assert.equal(calls, 1);
  });
});

test('proactive compaction and actual overflow co-trigger recover different remaining prefixes', async () => {
  await fixture(async (options, policy) => {
    policy.enabled = true; policy.thresholds.monsoon = 1_000;
    await saveCompactionPolicy(options.dataDir, policy);
    let calls = 0; let summaries = 0;
    const prefixes: string[] = [];
    const caller = createCompactionCaller({ ...options, initialPromptTokens: 2_000,
      llm: { call: async () => { if (++calls === 1) throw overflow(); return success; } },
      summarize: async input => { prefixes.push(input.text); return ++summaries === 1 ? 'fact '.repeat(100) : 'facts'; } });
    await invoke(caller, history());
    assert.equal(calls, 2); assert.equal(summaries, 2);
    assert.notEqual(prefixes[0], prefixes[1]);
  });
});

test('concurrent compaction on same live history coalesces after durable commit', async () => {
  await fixture(async options => {
    let summaries = 0; const messages = history();
    const input = { ...options, messages, mode: 'partial' as const, reason: 'manual' as const,
      summarize: async () => { summaries++; await Promise.resolve(); return 'facts'; } };
    const plans = await Promise.all([compactMessages(input), compactMessages(input)]);
    assert.equal(summaries, 1);
    assert.equal(plans.filter(Boolean).length, 1);
  });
});
