import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispatchStartBuffer } from './dispatch-start-buffer.js';

test('会议轮次中的派发在轮次结束后才启动并按工位去重', () => {
  const started: string[] = [];
  const buffer = createDispatchStartBuffer(seatId => started.push(seatId));
  buffer.enqueue('seat-b');
  buffer.enqueue('seat-b');
  buffer.enqueue('seat-c');
  assert.deepEqual(started, []);
  buffer.flush();
  assert.deepEqual(started, ['seat-b', 'seat-c']);
});

test('会议 Agent 派发到本工位时立即启动，不等待整轮结束', () => {
  const started: string[] = [];
  const buffer = createDispatchStartBuffer(seatId => started.push(seatId));

  buffer.enqueue('seat-a', { immediate: true });
  buffer.enqueue('seat-b');
  assert.deepEqual(started, ['seat-a']);

  buffer.flush();
  assert.deepEqual(started, ['seat-a', 'seat-b']);
});
