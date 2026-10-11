import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamStore } from './store.js';
import { TeamRuntime } from './runtime.js';
import { teamExtension, teamToolDefs } from './tools.js';

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

test('一步启动只需任务、名称和请求标识；并发及重放只创建和执行一次', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-start-'));
  try {
    const owner = { agentId: 'a', sessionId: 's' };
    const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
    let calls = 0;
    const runtime = new TeamRuntime(new TeamStore(dir, owner), async () => { calls++; return 'checked'; });
    const extension = teamExtension(runtime, policy);
    assert.deepEqual(teamToolDefs().find(tool => tool.name === 'team_start')?.parameters?.required,
      ['name', 'task', 'requestId']);
    for (const toolName of ['team_start', 'team_dispatch']) {
      const requestId = teamToolDefs().find(tool => tool.name === toolName)?.parameters?.properties?.requestId;
      assert.match(requestId?.description ?? '', /1–160/);
      assert.match(requestId?.description ?? '', /字母.*数字.*下划线.*连字符/);
    }
    const args = { name: '审查员', task: '独立检查指定模块并报告证据；只读，不修改文件。', requestId: 'start-1' };
    const [first, duplicate] = await Promise.all([
      extension.call('team_start', args), extension.call('team_start', args),
    ]);
    const initial = JSON.parse(first);
    assert.equal(initial.memberId, JSON.parse(duplicate).memberId);
    assert.equal(initial.id, JSON.parse(duplicate).id);
    assert.equal(initial.status, 'running');
    await runtime.wait();
    const saved = await runtime.store.read();
    assert.equal(saved.members.length, 1);
    assert.equal(saved.members[0].mission, '审查员');
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await extension.call('team_start', args)).status, 'completed');
    await assert.rejects(extension.call('team_start', { ...args, task: 'different' }), /TEAM_REQUEST_CONFLICT/);
    assert.equal((await runtime.store.read()).members.length, 1);
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('一步启动落盘后崩溃，重放返回中断状态，不暗中重启', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-start-crash-'));
  try {
    const owner = { agentId: 'a', sessionId: 's' };
    const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const member = { name: '审查员', mission: '复核', rolePrompt: '', taskContext: '', constraints: '', permissions: policy };
    const old = new TeamStore(dir, owner, 'old-process');
    const first = await old.createAndStart(member, 'read only', policy, 'start-crash');
    const restored = new TeamStore(dir, owner, 'new-process');
    await restored.recoverInterrupted();
    const duplicate = await restored.createAndStart(member, 'read only', policy, 'start-crash');
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.memberId, first.memberId);
    assert.equal(duplicate.status, 'crashed');
    assert.equal((await restored.read()).members.length, 1);
    assert.equal((await restored.read()).reports.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
