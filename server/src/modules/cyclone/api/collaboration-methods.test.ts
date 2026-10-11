import assert from 'node:assert/strict';
import test from 'node:test';
import { cycloneCollaborationHandlers } from './collaboration-methods.js';

test('协作轮次解析接受 Schema 允许的 2 万字符消息并拒绝超限', () => {
  const handler = cycloneCollaborationHandlers({} as never, {} as never).startCollaborationRound;
  assert.ok(handler);
  const base = { workshopId: 'cyc-1', roomId: 'room-1' };
  assert.equal((handler.parse({ ...base, message: '字'.repeat(20_000) }) as {
    message: string;
  }).message.length, 20_000);
  assert.throws(() => handler.parse({ ...base, message: '字'.repeat(20_001) }));
});
