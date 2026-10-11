import assert from 'node:assert/strict';
import test from 'node:test';
import { cycloneOperationId } from '../domain/operation-snapshot.js';
import { CycloneExecutionRegistry } from './execution-registry.js';

test('气旋执行身份由领域协议生成而不依赖 HTTP 路由', () => {
  assert.equal(cycloneOperationId('seat', 'cyc-1', 'seat-1'), 'seat:cyc-1:seat-1');
  assert.equal(cycloneOperationId('room', 'cyc-1', 'room-1'), 'room:cyc-1:room-1');
});

test('气旋执行目录按工作室、目标类型和目标 ID 独立加锁', () => {
  const locks = new Set<string>();
  const acquire = (kind: string) => (workshopId: string, targetId: string) => {
    const key = `${kind}:${workshopId}:${targetId}`;
    if (locks.has(key)) return null;
    locks.add(key);
    return () => { locks.delete(key); };
  };
  const registry = new CycloneExecutionRegistry({
    seat: acquire('seat'), room: acquire('room'),
  });
  const seat = registry.begin({
    workshopId: 'cyc-1', targetKind: 'seat', targetId: 'seat-1', phase: 'seat-chat',
  });
  const room = registry.begin({
    workshopId: 'cyc-1', targetKind: 'room', targetId: 'room-1', phase: 'room-speak',
  });
  assert.equal(registry.list().length, 2);
  assert.throws(() => registry.begin({
    workshopId: 'cyc-1', targetKind: 'seat', targetId: 'seat-1', phase: 'seat-resume',
  }), hasCode('CYCLONE_EXECUTION_BUSY'));

  registry.finish(seat.operationId, seat.runId);
  registry.finish(room.operationId, room.runId);
  assert.deepEqual(registry.list(), []);
});

test('旧执行身份不能中止或释放同一目标的新执行', () => {
  const registry = new CycloneExecutionRegistry({ seat: () => () => {}, room: () => () => {} });
  const current = registry.begin({
    workshopId: 'cyc-2', targetKind: 'seat', targetId: 'seat-2', phase: 'seat-compact',
  });
  const signal = registry.signal(current.operationId, current.runId);
  assert.throws(
    () => registry.abort(current.operationId, 'cyclone-run-stale'),
    hasCode('CYCLONE_EXECUTION_CHANGED'),
  );
  assert.equal(signal.aborted, false);
  registry.abort(current.operationId, current.runId);
  assert.equal(signal.aborted, true);
  registry.finish(current.operationId, current.runId);
});

function hasCode(code: string): (error: unknown) => boolean {
  return error => (error as { data?: { code?: string } }).data?.code === code;
}
