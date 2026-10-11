import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkshopOperations, selectWorkshopOperations } from './workshop-operation-status';
import type { CollaborationProbeItem } from '../../../api/collaboration';

function fact(operationId: string, phase: string, status: CollaborationProbeItem['status'],
  parentOperationId = 'workshop-a'): CollaborationProbeItem {
  return { operationId, parentOperationId, title: operationId, phase, status };
}

test('中心探针把未打开的工位、群聊和会长运行映射到对应工作室实体', () => {
  const facts = selectWorkshopOperations([
    fact('seat:workshop-a:seat-1', 'seat-chat', 'running'),
    fact('room:workshop-a:room-1', 'room-speak', 'failed'),
    fact('room:workshop-a:room-2', 'chair-chat', 'crashed'),
  ], 'workshop-a');
  assert.equal(facts.seats.get('seat-1')?.status, 'running');
  assert.equal(facts.rooms.get('room-1')?.status, 'failed');
  assert.equal(facts.rooms.get('room-2')?.status, 'crashed');
});

test('工作室隔离和运行类型校验防止旧请求或派发事实污染状态', () => {
  const facts = selectWorkshopOperations([
    fact('seat:workshop-b:seat-1', 'seat-chat', 'running', 'workshop-b'),
    fact('seat:workshop-a:seat-1', 'dispatch', 'running'),
    fact('room:workshop-a:room-1', 'seat-chat', 'failed'),
    fact('room:workshop-a:room-2', 'room-speak', 'running', 'workshop-b'),
    fact('dispatch:dispatch-1', 'dispatch', 'running'),
  ], 'workshop-a');
  assert.equal(facts.seats.size, 0);
  assert.equal(facts.rooms.size, 0);
});

test('工作室目标位于全局第 101 项后仍会通过中心探针续页读到', async () => {
  const originalFetch = globalThis.fetch;
  const requested: Array<{ query: { cursor?: string; limit: number } }> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requested.push(body);
    const second = body.query.cursor === 'next-100';
    const items = second
      ? [fact('room:workshop-a:room-1', 'chair-chat', 'running')]
      : Array.from({ length: 100 }, (_, index) =>
        fact(`seat:workshop-b:seat-${index}`, 'seat-chat', 'completed', 'workshop-b'));
    return new Response(JSON.stringify({
      schemaVersion: 1, feature: 'cyclone', view: 'summary', revision: 'stable',
      observedAt: '2026-09-30T00:00:00.000Z', completeness: second ? 'complete' : 'partial',
      items, truncated: !second, ...(second ? {} : { nextCursor: 'next-100' }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const operations = await readWorkshopOperations('workshop-a');
    assert.equal(operations.rooms.get('room-1')?.status, 'running');
    assert.equal(requested.length, 2);
    assert.equal(requested[0]?.query.limit, 100);
    assert.equal(requested[1]?.query.cursor, 'next-100');
  } finally { globalThis.fetch = originalFetch; }
});
