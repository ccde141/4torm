import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamStore } from './store.js';
import { TeamRuntime } from './runtime.js';
import { createTeamHandoff } from './handoff.js';

test('收尾等待真实回报，一轮只投递一次，未确认回报下轮仍能接收', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-handoff-'));
  try {
    const store = new TeamStore(dir, { agentId: 'a', sessionId: 's' });
    const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const member = await store.create({ name: 'm', mission: 'm', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const runtime = new TeamRuntime(store, async () => { await gate; return 'real result'; });
    const handoff = createTeamHandoff(runtime);
    await runtime.dispatch(member.id, 'task', policy, 'one');
    let ended = false;
    const pending = handoff.beforeFinish().then(messages => { ended = true; return messages; });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(ended, false);
    release();
    assert.match((await pending)[0], /real result/);
    await runtime.wait();
    assert.deepEqual(await handoff.beforeFinish(), []);
    assert.equal((await store.read()).reports[0].acknowledged, false);
    assert.equal((await createTeamHandoff(runtime).notifications()).length, 1);
    await store.acknowledge([(await store.read()).reports[0].id]);
    assert.deepEqual(await createTeamHandoff(runtime).notifications(), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('等待可以中止或被新输入打断，不消费回报也不停止成员', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-handoff-stop-'));
  const store = new TeamStore(dir, { agentId: 'a', sessionId: 's' });
  const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = new TeamRuntime(store, async () => { await gate; return 'late'; });
  try {
    const member = await store.create({ name: 'm', mission: 'm', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
    await runtime.dispatch(member.id, 'task', policy, 'one');
    const controller = new AbortController();
    const waiting = createTeamHandoff(runtime).beforeFinish(controller.signal);
    controller.abort();
    assert.deepEqual(await waiting, []);
    assert.equal(runtime.isActive(), true);
    assert.deepEqual(await createTeamHandoff(runtime).beforeFinish(undefined, () => true), []);
    release();
    await runtime.wait();
    assert.equal((await createTeamHandoff(runtime).notifications()).length, 1);
  } finally { release(); await runtime.wait(); await rm(dir, { recursive: true, force: true }); }
});

test('回报持久化失败时收尾真实失败，不自动重跑工作', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-handoff-io-'));
  try {
    const store = new TeamStore(dir, { agentId: 'a', sessionId: 's' });
    const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const member = await store.create({ name: 'm', mission: 'm', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
    store.finish = async () => { throw new Error('fixture disk failure'); };
    let calls = 0;
    const runtime = new TeamRuntime(store, async () => { calls++; return 'side effect already happened'; });
    await runtime.dispatch(member.id, 'task', policy, 'one');
    await assert.rejects(runtime.wait(), /fixture disk failure/);
    await assert.rejects(createTeamHandoff(runtime).beforeFinish(), /fixture disk failure/);
    assert.equal(calls, 1);
    assert.equal((await store.read()).reports.length, 0);
    await runtime.dispatch(member.id, 'task', policy, 'one');
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
