import assert from 'node:assert/strict';
import test from 'node:test';
import { performGracefulShutdown } from './graceful-shutdown.js';

test('优雅退出按停止生产者到关闭服务的顺序执行', async () => {
  const order: string[] = [];

  await performGracefulShutdown({
    stopScheduler: () => { order.push('scheduler'); },
    stopTradewind: async () => { order.push('tradewind'); },
    drainTide: async () => { order.push('tide'); },
    drainCyclone: async () => { order.push('cyclone'); },
    drainWrites: async () => { order.push('writes'); },
    shutdownMcp: () => { order.push('mcp'); },
    closeServer: async () => { order.push('server'); },
  }, 100);

  assert.deepEqual(order, ['scheduler', 'tradewind', 'tide', 'cyclone', 'writes', 'mcp', 'server']);
});

test('优雅退出超过上限时明确失败', async () => {
  await assert.rejects(performGracefulShutdown({
    stopScheduler: () => {},
    stopTradewind: () => new Promise<void>(() => {}),
    drainTide: async () => {},
    drainCyclone: async () => {},
    drainWrites: async () => {},
    shutdownMcp: () => {},
    closeServer: async () => {},
  }, 5), /退出排空超过 5ms/);
});
