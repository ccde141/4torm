import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeatHistoryRefresher } from './seat-history-refresh.js';

function change(workshopId: string, scope: 'activity' | 'room', id: string) {
  return { type: 'change' as const, workshopId, scope, id, revision: 1 };
}

test('工位历史只响应自身 activity 和连接同步，状态版本变化才重载', async () => {
  let current = 'v1';
  let reads = 0;
  let reloads = 0;
  const refresher = createSeatHistoryRefresher('w1', 's1',
    async () => { reads++; return 'v2'; },
    () => current,
    async () => { reloads++; current = 'v2'; return true; });

  await refresher.wake(change('w2', 'activity', 's1'));
  await refresher.wake(change('w1', 'activity', 's2'));
  await refresher.wake(change('w1', 'room', 's1'));
  await refresher.wake({ type: 'disconnected' });
  assert.equal(reads, 0);
  await refresher.wake({ type: 'sync' });
  await refresher.wake(change('w1', 'activity', 's1'));
  assert.equal(reads, 2);
  assert.equal(reloads, 1);
  refresher.stop();
});

test('并发通知合并为至多一次后续校验，兜底轮询不叠加请求', async () => {
  let finishFirst!: (value: string) => void;
  let current = 'v1';
  let reads = 0;
  let reloads = 0;
  const refresher = createSeatHistoryRefresher('w1', 's1',
    () => { reads++; return reads === 1
      ? new Promise<string>(resolve => { finishFirst = resolve; }) : Promise.resolve('v2'); },
    () => current,
    async () => { reloads++; current = 'v2'; return true; });

  const first = refresher.poll();
  void refresher.poll();
  void refresher.wake(change('w1', 'activity', 's1'));
  void refresher.wake(change('w1', 'activity', 's1'));
  assert.equal(reads, 1);
  finishFirst('v1');
  await first;
  assert.equal(reads, 2);
  assert.equal(reloads, 1);
  refresher.stop();
});

test('工位切换后丢弃旧版本请求，不触发旧工位状态加载', async () => {
  let finish!: (value: string) => void;
  let reloads = 0;
  const refresher = createSeatHistoryRefresher('w1', 's1',
    () => new Promise<string>(resolve => { finish = resolve; }),
    () => 'v1',
    async () => { reloads++; return true; });
  const pending = refresher.wake({ type: 'sync' });
  refresher.stop();
  finish('v2');
  await pending;
  assert.equal(reloads, 0);
});

test('版本读取失败真实抛出且不自动重试', async () => {
  let reads = 0;
  const refresher = createSeatHistoryRefresher('w1', 's1',
    async () => { reads++; throw new Error('offline'); },
    () => 'v1', async () => true);
  await assert.rejects(refresher.wake({ type: 'sync' }), /offline/);
  assert.equal(reads, 1);
  refresher.stop();
});
