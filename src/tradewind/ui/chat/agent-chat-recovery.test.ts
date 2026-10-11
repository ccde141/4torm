import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSnapshotGate, createStatusRequestGate, readNodeSnapshot, shouldReplaySnapshotRound,
} from './agent-chat-runtime';

type Event = { type: string; seq?: number };

test('重连快照只提交最新一代，并按 seq 去重缓冲的增量', () => {
  const gate = createSnapshotGate<Event>();
  const first = gate.start();
  assert.deepEqual(gate.receive({ type: 'token', seq: 1 }), []);
  const second = gate.start();
  assert.deepEqual(gate.receive({ type: 'token', seq: 3 }), []);
  assert.equal(gate.finish(first, 1), null);
  assert.deepEqual(gate.finish(second, 2), [{ type: 'token', seq: 3 }]);
  assert.deepEqual(gate.receive({ type: 'token', seq: 3 }), []);
  assert.deepEqual(gate.receive({ type: 'done', seq: 4 }), [{ type: 'done', seq: 4 }]);
});

test('快照失败或传输断开时释放缓冲，保留已收到的内容', () => {
  const gate = createSnapshotGate<Event>();
  const first = gate.start();
  gate.receive({ type: 'token', seq: 5 });
  assert.deepEqual(gate.fail(first), [{ type: 'token', seq: 5 }]);
  const second = gate.start();
  gate.receive({ type: 'token', seq: 6 });
  assert.deepEqual(gate.disconnect(), [{ type: 'token', seq: 6 }]);
  assert.equal(gate.finish(second, 6), null);
  assert.deepEqual(gate.receive({ type: 'token', seq: 7 }), [{ type: 'token', seq: 7 }]);
});

test('已提交 assistant 的终答日志不会在 busy 快照中再回放', () => {
  assert.equal(shouldReplaySnapshotRound({ busy: true, roundLog: [
    { type: 'token', content: '答' }, { type: 'answer', content: '答', rawContent: '答' },
    { type: 'done' },
  ] }), false);
  assert.equal(shouldReplaySnapshotRound({ busy: true, roundLog: [
    { type: 'token', content: '未完' },
  ] }), true);
  assert.equal(shouldReplaySnapshotRound({ busy: false, roundLog: [
    { type: 'token', content: '旧轮' },
  ] }), false);
});

test('快照 HTTP 失败和错误格式真实报错', async () => {
  await assert.rejects(readNodeSnapshot(Response.json(
    { message: 'snapshot unavailable' }, { status: 503 },
  )), /snapshot unavailable/);
  await assert.rejects(readNodeSnapshot(Response.json({ busy: true })), /快照/);
});

test('可见性 status 旧响应晚于新轮事件时不能清除运行态', async () => {
  const gate = createStatusRequestGate();
  let resolveStatus!: (value: { busy: boolean }) => void;
  const delayedStatus = new Promise<{ busy: boolean }>(resolve => { resolveStatus = resolve; });
  const oldRequest = gate.begin();
  const oldDecision = delayedStatus.then(status => gate.shouldClearStreaming(oldRequest, status));

  gate.advanceEvent();
  resolveStatus({ busy: false });
  assert.equal(await oldDecision, false);

  const currentRequest = gate.begin();
  assert.equal(gate.shouldClearStreaming(currentRequest, { busy: false }), true);
  gate.cancel(currentRequest);
  assert.equal(gate.shouldClearStreaming(currentRequest, { busy: false }), false);
});

test('后发的 status 请求和快照提交会淘汰先发请求', () => {
  const gate = createStatusRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.shouldClearStreaming(first, { busy: false }), false);
  assert.equal(gate.shouldClearStreaming(second, { busy: false }), true);
  gate.advanceEvent(); // 接受新快照时也必须推进事件版本
  assert.equal(gate.shouldClearStreaming(second, { busy: false }), false);
});
