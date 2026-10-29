import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamStore } from './store.js';

const owner = { agentId: 'agent-one', sessionId: 'session-one' };
const policy = { tools: ['read_file'], skills: ['review'], sandboxLevel: 'project' as const };
const definition = {
  name: 'Reviewer', mission: 'Review changes', rolePrompt: 'Check evidence',
  taskContext: 'Shared project', constraints: 'Read only', permissions: policy,
};

test('解散保留招募时间、首次解散时间和完整成员上下文', async t => {
  const { root, store } = await fixture(t);
  const member = await store.create(definition, policy);
  assert.ok(member.recruitedAt && Number.isFinite(Date.parse(member.recruitedAt)));
  const run = await store.start(member.id, '核验', policy);
  await store.checkpoint(member.id, run.id, [{ role: 'user', content: '原始任务' }, { role: 'assistant', content: '核验结果' }]);
  await store.finish(member.id, run.id, 'completed', '完成');
  await store.dismiss(member.id);
  const first = (await store.read()).members[0];
  assert.ok(first.dismissedAt); assert.equal(first.recruitedAt, member.recruitedAt);
  await store.dismiss(member.id);
  const saved = (await new TeamStore(root, owner).read()).members[0];
  assert.equal(saved.dismissedAt, first.dismissedAt); assert.deepEqual(saved.context, first.context);
});

async function fixture(t: test.TestContext, runtimeId = 'process-one') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-team-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: new TeamStore(root, owner, runtimeId) };
}

test('members persist independently of main history and stay idle between tasks', async t => {
  const { root, store } = await fixture(t);
  const member = await store.create(definition, policy);
  const run = await store.start(member.id, 'Review file A', policy);
  await store.checkpoint(member.id, run.id, [{ role: 'user', content: 'Review file A' }]);
  await store.finish(member.id, run.id, 'completed', 'A is checked');
  const reloaded = await new TeamStore(root, owner).read();
  assert.equal(reloaded.members[0].lifecycle, 'active');
  assert.equal(reloaded.members[0].run?.status, 'completed');
  assert.equal(reloaded.members[0].context[0].content, 'Review file A');
  assert.equal(reloaded.reports[0].acknowledged, false);
  const second = await store.start(member.id, 'Review file B', policy);
  assert.notEqual(second.id, run.id);
  await assert.rejects(store.finish(member.id, run.id, 'completed', 'late'), /TEAM_RUN_CONFLICT/);
  await store.finish(member.id, second.id, 'failed', 'Provider rejected request');
  assert.equal((await store.read()).reports[1].outcome, 'failed');
});

test('concurrent mutations serialize and the same member has exactly one writer', async t => {
  const { store } = await fixture(t);
  const members = await Promise.all(Array.from({ length: 4 }, () => store.create(definition, policy)));
  assert.equal((await store.read()).members.length, 4);
  const starts = await Promise.allSettled([
    store.start(members[0].id, 'first', policy), store.start(members[0].id, 'second', policy),
  ]);
  assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(starts.filter(result => result.status === 'rejected').length, 1);
  await assert.rejects(store.dismiss(members[0].id), /TEAM_MEMBER_BUSY/);
});

test('dismiss preserves a read-only archive and cannot reactivate the old member', async t => {
  const { store } = await fixture(t);
  const member = await store.create(definition, policy);
  await store.dismiss(member.id);
  await store.dismiss(member.id);
  await assert.rejects(store.start(member.id, 'revive', policy), /TEAM_MEMBER_DISMISSED/);
  assert.equal((await store.read()).members[0].lifecycle, 'dismissed');
});

test('restart recovery marks old running work crashed exactly once and never starts work', async t => {
  const { root, store } = await fixture(t);
  const member = await store.create(definition, policy);
  await store.start(member.id, 'unfinished', policy);
  assert.equal((await store.recoverInterrupted()).reports.length, 0);
  const restarted = new TeamStore(root, owner, 'process-two');
  const recovered = await restarted.recoverInterrupted();
  assert.equal(recovered.members[0].run?.status, 'crashed');
  assert.equal(recovered.reports[0].outcome, 'crashed');
  assert.equal((await restarted.recoverInterrupted()).reports.length, 1);
  await assert.rejects(store.checkpoint(member.id, recovered.members[0].run!.id, []), /TEAM_RUN_CONFLICT/);
});

test('reports are read without consumption and acknowledged only by explicit ids', async t => {
  const { store } = await fixture(t);
  const member = await store.create(definition, policy);
  const run = await store.start(member.id, 'inspect', policy);
  await store.finish(member.id, run.id, 'completed', 'done');
  const snapshot = await store.read();
  await assert.rejects(store.acknowledge(['unknown']), /TEAM_REPORT_NOT_FOUND/);
  assert.equal((await store.read()).reports[0].acknowledged, false);
  await store.acknowledge([snapshot.reports[0].id]);
  assert.equal((await store.read()).reports[0].acknowledged, true);
});

test('member permissions cannot exceed current parent permissions', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.create({ ...definition, permissions: { ...policy, sandboxLevel: 'unrestricted' } }, policy), /TEAM_PERMISSION/);
  await assert.rejects(store.create({ ...definition, permissions: { ...policy, tools: ['write_file'] } }, policy), /TEAM_PERMISSION/);
  const member = await store.create(definition, policy);
  await assert.rejects(store.start(member.id, 'inspect', { ...policy, tools: [] }), /TEAM_PERMISSION/);
});

test('owner identity and corrupt files fail explicitly without replacing data', async t => {
  const { root, store } = await fixture(t);
  await assert.rejects(new TeamStore(root, { ...owner, sessionId: '../escape' }).read(), /TEAM_INVALID/);
  await store.create(definition, policy);
  const other = new TeamStore(root, { ...owner, sessionId: 'other' });
  assert.equal((await other.read()).members.length, 0);
  const file = path.join(root, 'agents', owner.agentId, 'sessions', `${owner.sessionId}.team`, 'state.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(store.read(), /TEAM_CORRUPT/);
  await assert.rejects(store.create(definition, policy), /TEAM_CORRUPT/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('team storage rejects junctions instead of following them outside its session', async t => {
  const { root, store } = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-team-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const directory = path.join(root, 'agents', owner.agentId, 'sessions');
  await fs.mkdir(directory, { recursive: true });
  await fs.symlink(outside, path.join(directory, `${owner.sessionId}.team`), 'junction');
  await assert.rejects(store.create(definition, policy), /TEAM_PATH_UNSAFE/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('rejected context snapshots keep the last checkpoint and preserve provider fields', async t => {
  const { store } = await fixture(t);
  const member = await store.create(definition, policy);
  const run = await store.start(member.id, 'inspect', policy);
  const context = [{ role: 'assistant' as const, content: 'working',
    reasoningEnvelope: { field: 'reasoning_details' as const, value: [{ text: 'provider reasoning' }] },
    toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a"}' }] },
  { role: 'tool' as const, content: 'file content', toolCallId: 'call-1' }];
  await store.checkpoint(member.id, run.id, context);
  await assert.rejects(store.checkpoint(member.id, run.id, [
    { role: 'user', content: 'invalid', toolCalls: context[0].toolCalls },
  ]), /TEAM_INVALID_CONTEXT/);
  assert.deepEqual((await store.read()).members[0].context, context);
});
