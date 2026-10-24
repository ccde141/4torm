import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import type { CompactionOptions, CompactionProgress } from './contracts.js';
import { compactMessages } from './controller.js';
import { defaultCompactionPolicy } from './policy.js';

const options: CompactionOptions = { dataDir: '', area: 'monsoon', kind: 'conversation',
  model: 'p:current', protectedPrefixCount: 1, resolveSummaryBudget: async () => 16_000,
  summarize: async () => 'retained facts' };

function input() {
  const messages: ContextMessage[] = [{ role: 'system', content: 'static rules' },
    { role: 'user', content: 'a'.repeat(3_000) },
    { role: 'assistant', content: 'b'.repeat(3_000) }];
  return { ...options, messages, mode: 'full' as const, reason: 'manual' as const,
    policy: defaultCompactionPolicy() };
}

function barrier() {
  let release!: () => void;
  return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

test('lifecycle starts before archiving and completes only after durable commit', async () => {
  const request = input();
  const original = structuredClone(request.messages);
  const events: CompactionProgress[] = [];
  const order: string[] = [];
  const plan = await compactMessages({ ...request,
    onProgress: event => { events.push(event); if (!event.message) order.push(event.type); },
    archive: async () => { order.push('archive'); },
    summarize: async summary => {
      order.push('summary'); summary.onChunk?.('provisional fragment');
      assert.deepEqual(request.messages, original);
      return 'retained facts';
    },
    onSummaryChunk: () => { assert.deepEqual(request.messages, original); },
    commit: async () => { order.push('commit'); assert.deepEqual(request.messages, original); },
  });
  assert.deepEqual(order, ['compact-start', 'archive', 'summary', 'commit', 'compact-done']);
  assert.equal(events[0].id, events[1].id);
  assert.ok(events[0].id);
  assert.equal(events[1].startedAt, events[0].startedAt);
  assert.ok(events[1].updatedAt >= events[0].updatedAt);
  assert.equal(events[1].operation, 'compact');
  assert.equal(events.at(-1)!.archivedMessages, plan!.prefix.length);
  assert.equal(events.at(-1)!.summaryLength, plan!.summary.length);
  assert.ok(events.filter(event => event.message).every(event => event.id === events[0].id));
});

test('a queued cancellation never archives or summarizes its original history', async () => {
  const first = input(); const second = input();
  const entered = barrier(); const finish = barrier();
  const running = compactMessages({ ...first, scopeKey: 'same-session',
    summarize: async () => { entered.release(); await finish.wait; return 'retained facts'; } });
  await entered.wait;
  const controller = new AbortController();
  const original = structuredClone(second.messages); let archived = false;
  const events: CompactionProgress[] = [];
  const queued = compactMessages({ ...second, scopeKey: 'same-session', signal: controller.signal,
    archive: async () => { archived = true; }, onProgress: event => { events.push(event); },
    summarize: async () => { assert.fail('cancelled request must not summarize'); } });
  controller.abort(); finish.release();
  await running;
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(archived, false);
  assert.deepEqual(second.messages, original);
  assert.deepEqual(events.map(event => event.type), ['compact-start', 'compact-failed']);
  assert.equal(events[1].aborted, true);
});

test('cancellation after archive or during streamed summary never commits provisional text', async () => {
  for (const stage of ['archive', 'summary'] as const) {
    const request = input(); const original = structuredClone(request.messages);
    const controller = new AbortController(); let summaries = 0; let commits = 0;
    const events: CompactionProgress[] = [];
    await assert.rejects(compactMessages({ ...request, signal: controller.signal,
      onProgress: event => { events.push(event); },
      archive: async () => { if (stage === 'archive') controller.abort(); },
      summarize: async summary => {
        summaries++; summary.onChunk?.('partial summary'); controller.abort();
        return 'retained facts'; // A provider may finish despite the abort signal.
      },
      onSummaryChunk: () => { assert.deepEqual(request.messages, original); },
      commit: async () => { commits++; },
    }), { name: 'AbortError' });
    assert.equal(summaries, stage === 'summary' ? 1 : 0);
    assert.equal(commits, 0);
    assert.deepEqual(request.messages, original);
    assert.equal(events.at(-1)!.type, 'compact-failed');
    assert.equal(events.at(-1)!.aborted, true);
  }
});

test('commit rejection preserves original context and reports failure without completion', async () => {
  const request = input(); const original = structuredClone(request.messages);
  const events: CompactionProgress[] = [];
  await assert.rejects(compactMessages({ ...request,
    onProgress: event => { events.push(event); },
    commit: async () => { throw new Error('atomic replacement failed'); },
  }), /atomic replacement failed/);
  assert.deepEqual(request.messages, original);
  assert.deepEqual(events.filter(event => !event.message || event.type !== 'compact-start').map(event => event.type), ['compact-start', 'compact-failed']);
  assert.equal(events.at(-1)!.aborted, false);
});

test('successful commit survives a late abort and rejected completion observers', async () => {
  const request = input(); const controller = new AbortController();
  const events: CompactionProgress[] = [];
  let durable: ContextMessage[] | undefined;
  const plan = await compactMessages({ ...request, signal: controller.signal,
    commit: async pending => { durable = structuredClone(pending.messages); controller.abort(); },
    onCompacted: () => { throw new Error('connection closed after commit'); },
    onProgress: event => { events.push(event); throw new Error('disconnected observer'); },
  });
  assert.deepEqual(request.messages, durable);
  assert.deepEqual(request.messages, plan!.messages);
  assert.deepEqual(events.filter(event => !event.message).map(event => event.type), ['compact-start', 'compact-done']);
  assert.equal(events.at(-1)!.aborted, undefined);
});

test('archive callbacks receive detached history and cannot edit the source or summary', async () => {
  const request = input(); const original = structuredClone(request.messages);
  await compactMessages({ ...request,
    archive: async before => { before[1].content = 'archive adapter edit'; before.pop(); },
    summarize: async summary => {
      assert.deepEqual(request.messages, original);
      assert.ok(summary.text.includes('a'.repeat(3_000)));
      assert.ok(!summary.text.includes('archive adapter edit'));
      return 'retained facts';
    },
  });
  assert.equal(request.messages[0].content, 'static rules');
});

test('source revision changes reject the summary instead of overwriting new messages', async () => {
  const request = input(); let commits = 0;
  await assert.rejects(compactMessages({ ...request,
    summarize: async () => {
      request.messages.push({ role: 'user', content: 'newer turn' });
      return 'retained facts';
    },
    commit: async () => { commits++; },
  }), /会话已发生变化/);
  assert.equal(commits, 0);
  assert.equal(request.messages.at(-1)!.content, 'newer turn');
});

test('no-op compaction remains null and emits no lifecycle', async () => {
  const request = input(); const events: CompactionProgress[] = [];
  const result = await compactMessages({ ...request, messages: request.messages.slice(0, 1),
    onProgress: event => { events.push(event); } });
  assert.equal(result, null);
  assert.deepEqual(events, []);
});

test('retained tail keeps object identity for continuation cleanup after compression', async () => {
  const request = input();
  const protectedMessage = request.messages[0];
  const recent: ContextMessage = { role: 'user', content: 'continue the current task' };
  const temporary: ContextMessage = { role: 'assistant', content: 'unfinished answer' };
  const hint: ContextMessage = { role: 'user', content: '[System: continuation] finish' };
  request.messages.push(recent, temporary, hint);
  await compactMessages({ ...request, mode: 'partial', boundaries: () => [3] });
  assert.equal(request.messages[0], protectedMessage);
  assert.equal(request.messages.at(-3), recent);
  assert.equal(request.messages.at(-2), temporary);
  assert.equal(request.messages.at(-1), hint);
});
