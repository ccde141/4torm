import assert from 'node:assert/strict';
import test from 'node:test';
import { settleRoomRun } from './settle-room-run';

test('旧历史刷新晚于新运行返回时，不清理新运行，也不消费待发消息', async () => {
  const old = { id: 'old' }, newer = { id: 'new' };
  let current = old;
  let complete!: (loaded: boolean) => void;
  const history = new Promise<boolean>(resolve => { complete = resolve; });
  const queue = ['稍后处理的消息'];
  const pending = settleRoomRun(old, { reload: () => history, current: () => current,
    finish: () => { queue.shift(); } });
  current = newer; complete(true);
  assert.equal(await pending, 'replaced');
  assert.deepEqual(queue, ['稍后处理的消息']);
});
test('历史刷新失败保留结束态与消息，成功重试后只接续一次', async () => {
  const current = { id: 'done' };
  let loaded = false, finishes = 0;
  const options = { reload: async () => loaded, current: () => current, finish: () => { finishes++; } };
  assert.equal(await settleRoomRun(current, options), 'retry'); assert.equal(finishes, 0);
  loaded = true;
  assert.equal(await settleRoomRun(current, options), 'settled'); assert.equal(finishes, 1);
});
test('面板关闭或工位退出后，未返回的刷新不会触发后续操作', async () => {
  const old = { id: 'old' };
  let current: typeof old | undefined = old;
  let complete!: (loaded: boolean) => void;
  let finished = false;
  const pending = settleRoomRun(old, { reload: () => new Promise(resolve => { complete = resolve; }),
    current: () => current, finish: () => { finished = true; } });
  current = undefined; complete(true);
  assert.equal(await pending, 'replaced'); assert.equal(finished, false);
});
