import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import type { CycloneDispatchService } from './dispatch-service.js';
import { CycloneAgentDispatchService } from './agent-dispatch-service.js';
import { cycloneAgentDispatchHandlers } from '../api/agent-dispatch-methods.js';

test('派发回报分页、长正文续读、变化游标与只带入决策', async () => {
  const items = [dispatch('a', '第一条'), dispatch('b', '第二条')];
  const calls: unknown[][] = [];
  const source = {
    listWorkshop: async () => items,
    act: async (...args: unknown[]) => {
      calls.push(args);
      return items.find(item => item.id === args[2]);
    },
  } as unknown as CycloneDispatchService;
  const service = new CycloneAgentDispatchService(source);
  const first = await service.list('cyc-a', 1);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  assert.equal(first.items[0]?.response.length, 400);
  assert.equal((await service.list('cyc-a', 1, first.nextCursor)).items[0]?.id, 'a');
  const detail = await service.read('cyc-a', 'b', 'response', 6_000);
  assert.equal(detail.content.length, 4_000);
  assert.equal(detail.nextOffset, undefined);
  const included = await service.include('cyc-a', 'room-a', 'b');
  assert.equal(included.id, 'b');
  assert.deepEqual(calls, [['cyc-a', 'room-a', 'b', 'include']]);
  items[0].updatedAt = 'changed';
  await assert.rejects(service.list('cyc-a', 1, first.nextCursor),
    hasCode('CYCLONE_DISPATCH_LIST_CHANGED'));
});

test('大于一百万字符的派发正文仍能按返回的续读位置取到后段', async () => {
  const item = { ...dispatch('long', '长任务'), response: '字'.repeat(1_010_000) };
  const service = new CycloneAgentDispatchService({
    listWorkshop: async () => [item],
  } as never);
  const handler = cycloneAgentDispatchHandlers(service).readCollaborationDispatch;
  assert.ok(handler);
  const input = handler.parse({ workshopId: 'cyc-a', dispatchId: 'long',
    part: 'response', offset: 1_002_000 }) as {
      workshopId: string; dispatchId: string; part: 'response'; offset: number;
    };
  const page = await service.read(input.workshopId, input.dispatchId, input.part, input.offset);
  assert.equal(page.content.length, 6_000);
  assert.equal(page.nextOffset, 1_008_000);
});

function dispatch(id: string, title: string): CycloneDispatch {
  return {
    id, workshopId: 'cyc-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '发起人', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行人',
    task: title, status: 'completed', readState: 'unread', decisionState: 'pending',
    response: '结果'.repeat(5_000), createdAt: id === 'a' ? '2026-01-01' : '2026-01-02',
    updatedAt: '2026-01-02',
  };
}

function hasCode(code: string) {
  return (error: unknown) => (error as { data?: { code?: string } }).data?.code === code;
}
