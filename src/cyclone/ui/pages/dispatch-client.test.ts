import assert from 'node:assert/strict';
import test from 'node:test';
import { actOnDispatch, markSeatDispatchesRead } from './dispatch-client.js';

test('派发决策与工位已读回执只通过中心调用', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json([]);
  };
  try {
    await actOnDispatch('workshop-1', 'room-1', 'dispatch-1', 'include');
    await markSeatDispatchesRead('workshop-1', 'seat-1');
    assert.deepEqual(calls, [{
      feature: 'cyclone', method: 'actOnDispatch', input: {
        workshopId: 'workshop-1', roomId: 'room-1', dispatchId: 'dispatch-1', action: 'include',
      },
    }, {
      feature: 'cyclone', method: 'markSeatDispatchesRead', input: {
        workshopId: 'workshop-1', seatId: 'seat-1',
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
