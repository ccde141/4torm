import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamStore } from './store.js';
import { TeamRuntime } from './runtime.js';

test('同一派工请求在并发、完成、后续派工及重启后都不重复执行', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-dedupe-'));
  try {
    const owner = { agentId: 'a', sessionId: 's' };
    const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const store = new TeamStore(dir, owner);
    const member = await store.create({ name: 'm', mission: 'm', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
    let calls = 0;
    const runtime = new TeamRuntime(store, async () => { calls++; return 'done'; });
    const [first, duplicate] = await Promise.all([
      runtime.dispatch(member.id, 'task', policy, 'request-1'),
      runtime.dispatch(member.id, 'task', policy, 'request-1'),
    ]);
    assert.equal(first.id, duplicate.id);
    await runtime.wait();
    await runtime.dispatch(member.id, 'task', policy, 'request-1');
    assert.equal(calls, 1);
    await assert.rejects(runtime.dispatch(member.id, 'different', policy, 'request-1'), /TEAM_REQUEST_CONFLICT/);
    await runtime.dispatch(member.id, 'next', policy, 'request-2');
    await runtime.wait();
    const restored = new TeamRuntime(new TeamStore(dir, owner), async () => { calls++; return 'unexpected'; });
    assert.equal((await restored.dispatch(member.id, 'task', policy, 'request-1')).id, first.id);
    assert.equal(calls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('落盘派工后进程退出，恢复为中断；重发旧请求不会重新启动', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-dedupe-crash-'));
  try {
    const owner = { agentId: 'a', sessionId: 's' };
    const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const old = new TeamStore(dir, owner, 'old-process');
    const member = await old.create({ name: 'm', mission: 'm', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
    const run = await old.start(member.id, 'task', policy, 'request');
    const restored = new TeamStore(dir, owner, 'new-process');
    await restored.recoverInterrupted();
    let calls = 0;
    const runtime = new TeamRuntime(restored, async () => { calls++; return ''; });
    const receipt = await runtime.dispatch(member.id, 'task', policy, 'request');
    assert.equal(receipt.id, run.id);
    assert.equal(receipt.status, 'crashed');
    assert.equal(calls, 0);
    assert.equal((await restored.read()).reports.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
