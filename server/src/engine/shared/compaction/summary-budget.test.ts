import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompactionOptions, CompactionSummaryInput } from './contracts.js';
import { estimateTextTokens, serializeCompactionMessages } from './estimate.js';
import { summarizeCompactionPrefix } from './summary.js';
import { resolveSummaryModelBudget, summaryGenerationBudget, summaryOutputBudget } from './budget.js';

async function fixture(run: (options: CompactionOptions) => Promise<void>) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-summary-budget-'));
  try { await run({ dataDir, area: 'monsoon', kind: 'conversation', model: 'p:model',
    resolveSummaryBudget: async () => 500_000 }); }
  finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

test('a large selected history reaches one request intact instead of being split or checkpointed', async () => {
  await fixture(async options => {
    const requests: CompactionSummaryInput[] = [];
    const messages = [{ role: 'user' as const, content: 'HEAD-42\n' + '原'.repeat(250_000) + '\nTAIL-42待验收。' }];
    const summary = await summarizeCompactionPrefix({ ...options, scopeKey: 'session:42',
      summarize: async input => { requests.push(input); return 'HEAD-42已核验；TAIL-42待验收。'; } }, messages);
    assert.match(summary, /TAIL-42/);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].messages, messages);
    assert.equal(requests[0].text, serializeCompactionMessages(messages));
    assert.match(requests[0].text, /^\[user\]\nHEAD-42/);
    assert.ok(requests[0].text.endsWith('TAIL-42待验收。'));
    await assert.rejects(fs.stat(path.join(options.dataDir, 'runtime', 'compaction')), { code: 'ENOENT' });
  });
});

test('manual and automatic compaction receive independent generous body ceilings', async () => {
  assert.equal(summaryOutputBudget(), 30_000);
  assert.equal(summaryOutputBudget('threshold'), 60_000);
  assert.equal(summaryOutputBudget('provider-overflow'), 60_000);
  await fixture(async options => {
    for (const reason of ['manual', 'threshold', 'provider-overflow'] as const) {
      let request: CompactionSummaryInput | undefined;
      await summarizeCompactionPrefix({ ...options, summarize: async input => {
        request = input; return 'TASK-42仍待验收。';
      } }, [{ role: 'user', content: '已确认事实。'.repeat(100) }], undefined, reason);
      const body = reason === 'manual' ? 30_000 : 60_000;
      assert.equal(request!.maxContentTokens, body);
      assert.equal(request!.maxOutputTokens, body + 2_048);
      assert.equal(request!.maxReasoningTokens, 2_048);
      assert.ok(request!.prompt.includes('正文上限为 ' + body + ' token'));
    }
  });
});

test('the full rendered request must fit an explicit input allowance without truncation or subdivision', async () => {
  await fixture(async options => {
    let calls = 0;
    const messages = [{ role: 'tool' as const, toolCallId: 'TOOL-42',
      content: ('C:\\source\\file\n\t"quoted"').repeat(6_000) }];
    const before = structuredClone(messages);
    await assert.rejects(summarizeCompactionPrefix({ ...options, resolveSummaryBudget: async () => 8_000,
      summarize: async () => { calls++; return '不会执行'; } }, messages), /整段历史超过.*输入容量/);
    assert.equal(calls, 0);
    assert.deepEqual(messages, before);
  });
});

test('known combined context narrows output rather than rejecting input that can fit with a smaller summary', () => {
  const limits = { inputTokens: 180_000, maxContentTokens: 60_000,
    maxOutputTokens: 62_048, contextTokens: 242_048 };
  const request = summaryGenerationBudget(220_000, limits);
  assert.ok(request.maxContentTokens > 20_000);
  assert.ok(request.maxContentTokens < 60_000);
  assert.ok(220_000 + request.maxOutputTokens + 256 <= limits.contextTokens);
  assert.ok(request.maxReasoningTokens <= 2_048);
  assert.throws(() => summaryGenerationBudget(242_048, limits), /整段历史超过.*上下文容量/);
});

test('original system framing and tool declarations both count toward the summary request capacity', async () => {
  await fixture(async options => {
    let calls = 0;
    const history = [{ role: 'user' as const, content: '已核验事实。'.repeat(100) }];
    await assert.rejects(summarizeCompactionPrefix({ ...options,
      resolveSummaryBudget: async () => 8_000,
      summaryContext: { messages: [{ role: 'system', content: '原'.repeat(5_000) }],
        tools: [{ name: 'read', description: '工'.repeat(5_000), parameters: { type: 'object' } }] },
      summarize: async () => { calls++; return '不会执行'; },
    }, history), /整段历史超过.*输入容量/);
    assert.equal(calls, 0);
    assert.equal(history[0].content, '已核验事实。'.repeat(100));
  });
});

test('a 180K model accepts a complete 100K source with the full automatic 60K body ceiling', async () => {
  await fixture(async options => {
    await fs.writeFile(path.join(options.dataDir, 'providers.json'), JSON.stringify({ providers: [{
      id: 'local', baseUrl: 'http://summary-180k.test/v1', models: ['model'], providerType: 'llama-cpp',
    }] }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      default_generation_settings: { n_ctx: 180_000 },
    }));
    try {
      let request: CompactionSummaryInput | undefined;
      const messages = [{ role: 'user' as const, content: '原'.repeat(100_000) + 'TAIL-180待完成。' }];
      await summarizeCompactionPrefix({ ...options, model: 'local:model', resolveSummaryBudget: undefined,
        summarize: async input => { request = input; return 'TAIL-180仍待完成。'; } },
      messages, undefined, 'threshold');
      assert.equal(request!.text, serializeCompactionMessages(messages));
      assert.deepEqual(request!.messages, messages);
      assert.equal(request!.maxContentTokens, 60_000);
      assert.equal(request!.maxOutputTokens, 62_048);
      assert.equal(request!.maxReasoningTokens, 2_048);
    } finally { globalThis.fetch = originalFetch; }
  });
});

test('the final context allowance is respected without a hidden minimum or intermediate summaries', async () => {
  await fixture(async options => {
    const requests: CompactionSummaryInput[] = [];
    const displayed: string[] = [];
    const summary = await summarizeCompactionPrefix({ ...options, summaryTokenBudget: 7,
      onSummaryChunk: text => displayed.push(text), summarize: async input => {
        requests.push(input); return '尚待验收。';
      } }, [{ role: 'user', content: '原'.repeat(5_000) }]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].maxContentTokens, 7);
    assert.ok(estimateTextTokens(summary) <= 7);
    assert.deepEqual(displayed, [summary]);
  });
});

test('an output-limited summary fails once without publishing or recursively reprocessing its source', async () => {
  await fixture(async options => {
    const displayed: string[] = [];
    let calls = 0;
    await assert.rejects(summarizeCompactionPrefix({ ...options,
      onSummaryChunk: text => displayed.push(text), summarize: async input => {
        calls++; input.onChunk?.('不完整摘要'); input.onOutputLimited?.(); return '不完整摘要';
      } }, [{ role: 'user', content: '原'.repeat(5_000) + 'TAIL-42待验收。' }]),
    { name: 'SummaryOutputLimitError' });
    assert.equal(calls, 1);
    assert.deepEqual(displayed, []);
  });
});

test('unknown model capacity does not invent the former 16K input ceiling', async () => {
  await fixture(async options => {
    await fs.writeFile(path.join(options.dataDir, 'providers.json'), JSON.stringify({ providers: [{
      id: 'unknown', baseUrl: 'https://unused.test/v1', models: ['model'],
    }] }));
    const budget = await resolveSummaryModelBudget(options.dataDir, 'unknown:model', 'threshold');
    assert.equal(budget.inputTokens, undefined);
    assert.equal(budget.contextTokens, undefined);
    assert.equal(budget.maxContentTokens, 60_000);
    assert.equal(summaryGenerationBudget(250_000, budget).maxContentTokens, 60_000);
  });
});
