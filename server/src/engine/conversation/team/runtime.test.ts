import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamRuntime } from './runtime.js';
import { TeamStore } from './store.js';

test('member compaction uses existing run phases without publishing new human-facing activity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-compaction-phase-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new TeamStore(root, { agentId: 'a', sessionId: 's' });
  const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
  const member = await store.create({ name: 'Researcher', mission: 'TASK-42', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
  const phases: string[] = [], activity: string[] = [];
  const record = store.activity.bind(store);
  t.mock.method(store, 'activity', async (...args) => { phases.push(args[2]); await record(...args); });
  const runtime = new TeamRuntime(store, async (_member, _task, _checkpoint, _signal, control) => {
    control.observe({ type: 'compact-start', id: 'compaction', operation: 'compact', reason: 'threshold', startedAt: 1, updatedAt: 1 });
    const request = { id: 'summary', purpose: 'compaction' as const, state: 'prepared' as const,
      startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      estimatedInputTokens: 70_000, imageCount: 0, usageComplete: false };
    control.observe({ type: 'model-request', request });
    control.observe({ type: 'model-request', request: { ...request, state: 'completed' } });
    control.observe({ type: 'compact-done', id: 'compaction', operation: 'compact', reason: 'threshold', startedAt: 1, updatedAt: 2 });
    control.observe({ type: 'model-request', request: { ...request, id: 'continuation', purpose: 'conversation' } });
    return 'TASK-42 done';
  });
  runtime.subscribe(event => activity.push(event.stage));
  await runtime.dispatch(member.id, 'Continue TASK-42', policy);
  await runtime.wait();
  assert.deepEqual(phases, ['compacting', 'compacting', 'model', 'model']);
  assert.deepEqual(activity, ['dispatched', 'reported']);
});

test('dispatch returns before execution finishes, preserves history and records real failures', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new TeamStore(root, { agentId: 'a', sessionId: 's' });
  const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
  const member = await store.create({ name: 'Review', mission: 'review', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const runtime = new TeamRuntime(store, async (_member, task, checkpoint, signal) => {
    calls++;
    await gate;
    if (signal.aborted) throw new Error('aborted');
    if (task === 'fail') throw new Error('Provider rejected request');
    await checkpoint([{ role: 'assistant', content: 'saved result' }]);
    return 'saved result';
  });
  const first = await runtime.dispatch(member.id, 'first', policy);
  assert.equal((await store.read()).members[0].run?.status, 'running');
  await assert.rejects(runtime.dispatch(member.id, 'duplicate', policy), /TEAM_MEMBER_BUSY/);
  release();
  await runtime.wait();
  assert.equal((await store.read()).reports[0].runId, first.id);
  assert.equal((await store.read()).members[0].context[0].content, 'saved result');
  await runtime.dispatch(member.id, 'fail', policy);
  await runtime.wait();
  assert.equal((await store.read()).reports[1].outcome, 'failed');
  assert.match((await store.read()).reports[1].content, /Provider rejected/);
  assert.equal(calls, 2);
});

test('explicit stop cancels members and does not mark cancellation completed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-stop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new TeamStore(root, { agentId: 'a', sessionId: 's' });
  const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
  const member = await store.create({ name: 'Review', mission: 'review', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
  const runtime = new TeamRuntime(store, async (_m, _t, _c, signal) => {
    await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    return '';
  });
  await runtime.dispatch(member.id, 'work', policy);
  runtime.stop();
  await runtime.wait();
  assert.equal((await store.read()).reports[0].outcome, 'aborted');
});

test('canceling the main wait does not cancel independently running members', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-wait-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new TeamStore(root, { agentId: 'a', sessionId: 's' });
  const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
  const member = await store.create({ name: 'Review', mission: 'review', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = new TeamRuntime(store, async () => { await gate; return 'done'; });
  await runtime.dispatch(member.id, 'work', policy);
  const controller = new AbortController();
  const wait = runtime.waitBriefly(controller.signal);
  controller.abort();
  await assert.rejects(wait, /TEAM_WAIT_ABORTED/);
  assert.equal((await store.read()).members[0].run?.status, 'running');
  release();
  await runtime.wait();
  assert.equal((await store.read()).reports[0].outcome, 'completed');
});
