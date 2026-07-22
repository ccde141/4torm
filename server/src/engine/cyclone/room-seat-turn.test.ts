import assert from 'node:assert/strict';
import test from 'node:test';
import { runFreshSeatTurn } from './room-seat-turn.js';
import type { SeatData } from './types.js';

function seat(messages: SeatData['messages']): SeatData {
  return {
    id: 'seat-b', title: '代码助手', rolePrompt: '', agentId: 'agent-b', messages,
    createdAt: '', updatedAt: '',
  };
}

test('排队结束后重新读取工位，不能用旧对象覆盖派发写入的会话', async () => {
  const stale = seat([]);
  const fresh = seat([{ role: 'user', content: '异步派发任务' }]);
  let loaded = false;
  const result = await runFreshSeatTurn(stale, {
    load: async () => { loaded = true; return fresh; },
    run: async current => current.messages.length,
  });
  assert.equal(loaded, true);
  assert.equal(result, 1);
});
