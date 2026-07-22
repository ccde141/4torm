import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDispatch, updateDispatch } from './dispatch-store.js';
import { includeDispatchResult, markDispatchRead, dismissDispatch } from './dispatch-actions.js';
import { createRoom, loadRoom } from './room-store.js';
import { createWorkshop } from './workshop-store.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-dispatch-actions-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workshop = await createWorkshop(dataDir, { title: '测试工作室' });
  const room = await createRoom(dataDir, workshop.id, { title: '测试群聊' });
  const created = await createDispatch(dataDir, {
    workshopId: workshop.id, sourceRoomId: room.id, sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: '写报告',
  });
  const dispatch = await updateDispatch(dataDir, workshop.id, created.id, {
    status: 'completed', response: '报告已写入 workspace/report.md',
  });
  assert.ok(dispatch);
  return { dataDir, workshop, room, dispatch };
}

test('带入派发结果只在时间线末尾追加一次稳定系统消息', async (t) => {
  const { dataDir, workshop, room, dispatch } = await fixture(t);

  const first = await includeDispatchResult(dataDir, workshop.id, room.id, dispatch.id);
  const second = await includeDispatchResult(dataDir, workshop.id, room.id, dispatch.id);
  const saved = await loadRoom(dataDir, workshop.id, room.id);

  assert.equal(first.decisionState, 'included');
  assert.equal(second.includedMessageId, first.includedMessageId);
  assert.equal(saved?.publicMessages.length, 1);
  assert.deepEqual(saved?.publicMessages[0], {
    id: `dispatch-result-${dispatch.id}`,
    speaker: '系统',
    content: '异步工位「执行」已完成任务「写报告」：\n\n报告已写入 workspace/report.md',
    timestamp: saved?.publicMessages[0].timestamp,
    kind: 'dispatch-result',
    dispatchId: dispatch.id,
  });
});

test('已忽略的派发不能再带入，已读状态不改变决策', async (t) => {
  const { dataDir, workshop, room, dispatch } = await fixture(t);

  const read = await markDispatchRead(dataDir, workshop.id, room.id, dispatch.id);
  const dismissed = await dismissDispatch(dataDir, workshop.id, room.id, dispatch.id);

  assert.equal(read.readState, 'read');
  assert.equal(read.decisionState, 'pending');
  assert.equal(dismissed.decisionState, 'dismissed');
  await assert.rejects(
    includeDispatchResult(dataDir, workshop.id, room.id, dispatch.id),
    /已忽略的派发不能带入讨论/,
  );
});

test('派发不能通过其他房间的管理接口访问', async (t) => {
  const { dataDir, workshop, dispatch } = await fixture(t);
  await assert.rejects(
    markDispatchRead(dataDir, workshop.id, 'room-other', dispatch.id),
    /派发不存在/,
  );
});
