import assert from 'node:assert/strict';
import test from 'node:test';
import { failedWorkshopOperationView, successfulWorkshopOperationView } from './useWorkshopOperationStatus';
import type { CollaborationProbeItem } from '../../../api/collaboration';

function fact(status: CollaborationProbeItem['status']): CollaborationProbeItem {
  return { operationId: status, title: status, status };
}

test('观察失败撤销旧探针事实，并标记上次活跃实体为不确定', () => {
  const operations = {
    seats: new Map([['running-seat', fact('running')], ['waiting-seat', fact('waiting')],
      ['completed-seat', fact('completed')]]),
    rooms: new Map([['queued-room', fact('queued')], ['failed-room', fact('failed')]]),
  };
  const previous = successfulWorkshopOperationView('workshop-a', operations);
  const failed = failedWorkshopOperationView(previous, 'workshop-a', new Error('probe offline'));
  assert.equal(failed.error, 'probe offline');
  assert.equal(failed.operations.seats.size, 0);
  assert.equal(failed.operations.rooms.size, 0);
  assert.deepEqual([...failed.uncertain.seats].sort(), ['running-seat', 'waiting-seat']);
  assert.deepEqual([...failed.uncertain.rooms], ['queued-room']);
  assert.equal(previous.operations.seats.get('running-seat')?.status, 'running');
});

test('连续失败保留不确定性，成功读取与工作室切换都清除旧标记', () => {
  const running = successfulWorkshopOperationView('workshop-a', {
    seats: new Map([['seat-a', fact('running')]]), rooms: new Map(),
  });
  const failed = failedWorkshopOperationView(running, 'workshop-a', new Error('offline'));
  const failedAgain = failedWorkshopOperationView(failed, 'workshop-a', new Error('still offline'));
  assert.deepEqual([...failedAgain.uncertain.seats], ['seat-a']);
  assert.equal(failedAgain.error, 'still offline');

  const recovered = successfulWorkshopOperationView('workshop-a', {
    seats: new Map([['seat-a', fact('completed')]]), rooms: new Map(),
  });
  assert.equal(recovered.error, '');
  assert.equal(recovered.uncertain.seats.size, 0);
  assert.equal(recovered.operations.seats.get('seat-a')?.status, 'completed');

  const switched = failedWorkshopOperationView(failedAgain, 'workshop-b', new Error('offline'));
  assert.equal(switched.uncertain.seats.size, 0);
  assert.equal(switched.operations.seats.size, 0);
});
