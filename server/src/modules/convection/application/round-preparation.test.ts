import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createConvectionFeature } from '../api/factory.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-prepared-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'));
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: '会长' }, agent: { name: '成员' },
  }));
  const feature = createConvectionFeature({ dataDir });
  const room = await feature.sessions.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  return { feature, room };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('shutdown waits for begin persistence and cancels its newly prepared lock without execution', async t => {
  const { feature, room } = await fixture(t);
  const entered = gate();
  const blocked = gate();
  const start = feature.runs.start.bind(feature.runs);
  t.mock.method(feature.runs, 'start', async (...args: Parameters<typeof start>) => {
    entered.release(); await blocked.promise; return start(...args);
  });
  let called = false;
  feature.executor.speak = async () => { called = true; };
  const pending = feature.discussionRounds.prepare({ sessionId: room.id, round: 'public', message: '停止' });
  const rejected = assert.rejects(pending, /运行时正在关闭/);
  await entered.promise;
  const closing = feature.discussionRounds.shutdown();
  blocked.release();
  await rejected;
  await closing;
  assert.equal(called, false);
  assert.equal(feature.rounds.snapshot(room.id), null);
  assert.equal((await feature.runs.latest(room.id))?.status, 'aborted');
});

test('a returned prepared handle cannot start after closing even while another prepare is blocked', async t => {
  const { feature, room } = await fixture(t);
  const ready = await feature.discussionRounds.prepare({ sessionId: room.id, round: 'public', message: 'A' });
  const entered = gate();
  const blocked = gate();
  const require = feature.sessions.require.bind(feature.sessions);
  t.mock.method(feature.sessions, 'require', async (id: string) => {
    if (id === 'pending-room') { entered.release(); await blocked.promise; return { ...room, id }; }
    return require(id);
  });
  let called = false;
  feature.executor.speak = async () => { called = true; };
  const pending = feature.discussionRounds.prepare({ sessionId: 'pending-room', round: 'public', message: 'B' });
  const rejected = assert.rejects(pending, /运行时正在关闭/);
  await entered.promise;
  const closing = feature.discussionRounds.shutdown();
  await assert.rejects(ready.run(), /运行时正在关闭/);
  blocked.release();
  await rejected;
  await closing;
  assert.equal(called, false);
  assert.equal((await feature.runs.latest(room.id))?.status, 'aborted');
});

test('running disposal reports terminal IO failure but still releases the lock', async t => {
  const { feature, room } = await fixture(t);
  feature.executor.speak = async (_session, _message, _emit, signal) => new Promise<void>(resolve => {
    if (signal?.aborted) resolve(); else signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  t.mock.method(feature.runs, 'finish', async () => { throw new Error('injected terminal IO'); });
  await feature.discussionRounds.start({ sessionId: room.id, round: 'public', message: '运行' });
  await assert.rejects(feature.discussionRounds.shutdown(), /injected terminal IO/);
  assert.equal(feature.rounds.snapshot(room.id), null);
  await feature.sessions.rename(room.id, '锁已释放');
});

test('completed background terminal IO failures remain visible after their active slot is released', async t => {
  const { feature, room } = await fixture(t);
  feature.executor.speak = async () => undefined;
  t.mock.method(feature.runs, 'finish', async () => { throw new Error('injected background IO'); });
  await feature.discussionRounds.start({ sessionId: room.id, round: 'public', message: '完成' });
  await assert.rejects(feature.discussionRounds.drain(), /injected background IO/);
  await assert.rejects(feature.discussionRounds.shutdown(), /injected background IO/);
  assert.equal(feature.rounds.snapshot(room.id), null);
});

test('disposal during terminal commit waits without a second finish or abort', async t => {
  const { feature, room } = await fixture(t);
  const entered = gate();
  const blocked = gate();
  const finish = feature.runs.finish.bind(feature.runs);
  let commits = 0;
  t.mock.method(feature.runs, 'finish', async (...args: Parameters<typeof finish>) => {
    commits++; entered.release(); await blocked.promise; return finish(...args);
  });
  feature.executor.speak = async () => undefined;
  await feature.discussionRounds.start({ sessionId: room.id, round: 'public', message: '结束' });
  await entered.promise;
  const closing = feature.discussionRounds.shutdown();
  blocked.release();
  await closing;
  assert.equal(commits, 1);
  assert.equal((await feature.runs.latest(room.id))?.status, 'completed');
  assert.equal(feature.rounds.snapshot(room.id), null);
});

test('immediate repeated disposal cancels a claimed run before any executor work', async t => {
  const { feature, room } = await fixture(t);
  let called = false;
  feature.executor.speak = async () => { called = true; };
  const prepared = await feature.discussionRounds.prepare({ sessionId: room.id, round: 'public', message: '取消' });
  const pending = prepared.run();
  const rejected = assert.rejects(pending, /对流轮次已停止/);
  const first = prepared.dispose();
  assert.equal(prepared.dispose(), first);
  await first;
  await rejected;
  assert.equal(called, false);
  assert.equal((await feature.runs.latest(room.id))?.status, 'aborted');
});
