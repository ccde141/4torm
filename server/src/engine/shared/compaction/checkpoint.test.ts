import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openSummaryCheckpoint } from './checkpoint.js';
import { compactMessages } from './controller.js';
import { summarizeCompactionPrefix } from './summary.js';
import { compactionRequestDeadline, CompactionRequestTimeout } from './request-deadline.js';
import { defaultCompactionPolicy } from './policy.js';
import type { CompactionOptions } from './contracts.js';

async function fixture(run: (options: CompactionOptions) => Promise<void>) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compaction-resume-'));
  try { await run({ dataDir, scopeKey: 'project:seat:one', model: 'p:model', kind: 'conversation',
    area: 'cycloneConversation', resolveSummaryBudget: async () => 16_000 }); }
  finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

test('completed fragments survive cancellation and a fresh caller resumes without replaying them', async () => {
  await fixture(async options => {
    const messages = [{ role: 'user' as const, content: '源资料'.repeat(20_000) }];
    const before = structuredClone(messages);
    const controller = new AbortController();
    const visited: string[] = [];
    let commits = 0;
    const summarize = async (input: { text: string }) => { visited.push(input.text); return '确认事实与未完成任务。'; };
    await assert.rejects(compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
      signal: controller.signal, summarize, commit: async () => { commits++; },
      onStageProgress: stage => { if (stage.completed === 2) controller.abort(); } }), { name: 'AbortError' });
    assert.deepEqual(messages, before);
    assert.equal(commits, 0);
    const saved = visited.slice();
    let resumed = 0;
    await compactMessages({ ...options, messages, mode: 'full', reason: 'manual', summarize,
      commit: async () => { commits++; }, onStageProgress: stage => { if (stage.resumed && !stage.completed) resumed++; } });
    assert.equal(commits, 1);
    assert.ok(resumed > 0);
    for (const fragment of saved) assert.equal(visited.filter(value => value === fragment).length, 1);
  });
});

test('scope, model and source signature prevent checkpoint reuse across unrelated work', async () => {
  await fixture(async ({ dataDir }) => {
    const first = await openSummaryCheckpoint(dataDir, 'scope-a', 'model-a', 'source-one');
    await first!.save('fragment', 'fact from one');
    assert.equal((await openSummaryCheckpoint(dataDir, 'scope-a', 'model-a', 'source-one'))!.read('fragment'), 'fact from one');
    for (const [scope, model, source] of [['scope-a', 'model-a', 'source-two'], ['scope-b', 'model-a', 'source-one'], ['scope-a', 'model-b', 'source-one']]) {
      assert.equal((await openSummaryCheckpoint(dataDir, scope, model, source))!.read('fragment'), undefined);
    }
  });
});

test('an invalid final summary is not cached and an unchanged retry can ask the model again', async () => {
  await fixture(async options => {
    const messages = [{ role: 'user' as const, content: '唯一任务还未完成。'.repeat(10) }];
    let calls = 0;
    await assert.rejects(summarizeCompactionPrefix({ ...options, summarize: async input => {
      calls++; return input.text;
    } }, messages), /未减少/);
    const result = await summarizeCompactionPrefix({ ...options, summarize: async () => {
      calls++; return '待完成';
    } }, messages);
    assert.equal(result, '待完成');
    assert.equal(calls, 2);
  });
});

test('a timed out request is not automatically replayed against the alternate model', async () => {
  await fixture(async options => {
    const policy = { ...defaultCompactionPolicy(), fixedModel: 'p:alternate' };
    let calls = 0;
    await assert.rejects(summarizeCompactionPrefix({ ...options, summarize: async () => {
      calls++; throw new CompactionRequestTimeout('片段超时');
    } }, [{ role: 'user', content: '记录'.repeat(200) }], undefined, 'manual', policy), /片段超时/);
    assert.equal(calls, 1);
  });
});

for (const size of [256_000, 500_000, 999_000]) {
  test(`${size} estimated source tokens visit every fragment and converge within bounded budgets`, async () => {
    await fixture(async options => {
      const records = Array.from({ length: 32 }, (_, index) => `\n\nFACT-${index} 待核验\n` + '原'.repeat(Math.floor(size / 32)));
      const source = records.join('');
      const visited = new Set<string>();
      let calls = 0;
      const summary = await summarizeCompactionPrefix({ ...options, resolveSummaryBudget: async () => 1_000_000,
        summarize: async input => {
          calls++;
          assert.ok(input.maxOutputTokens <= 22_048);
          assert.ok(input.maxReasoningTokens! <= 2_048);
          assert.ok(input.text.length < 100_000);
          const ids = [...input.text.matchAll(/FACT-\d+/g)].map(match => match[0]);
          ids.forEach(id => visited.add(id));
          return [...new Set(ids)].join('；') + '待核验';
        } }, [{ role: 'user', content: source }]);
      assert.equal(visited.size, 32);
      assert.ok(calls > 2 && calls < 25);
      for (let index = 0; index < 32; index++) assert.ok(summary.includes(`FACT-${index}`));
    });
  });
}

test('request deadlines are independent, activity renews idle timeout, cancellation propagates', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const deadline = compactionRequestDeadline(undefined, { totalMs: 500, idleMs: 25 });
  try {
    t.mock.timers.tick(10);
    deadline.touch();
    assert.equal(deadline.signal.aborted, false);
    t.mock.timers.tick(40);
    assert.match(deadline.signal.reason.message, /长时间未响应/);
  } finally { deadline.dispose(); }
  const parent = new AbortController();
  const linked = compactionRequestDeadline(parent.signal);
  parent.abort(new Error('human stopped'));
  assert.equal(linked.signal.reason.message, 'human stopped');
  linked.dispose();
});
