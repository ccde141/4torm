import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamRuntime } from './runtime.js';
import { TeamStore } from './store.js';

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
