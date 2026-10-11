import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import {
  createCycloneSeatCompactionPort,
  type CycloneSeatCompactionRuntime,
} from './seat-compaction-adapter.js';
import { CycloneChangeFeed } from '../application/change-feed.js';

test('压缩预检失败保存 failed 并释放已取得的工位执行身份', async () => {
  const feed = new CycloneChangeFeed();
  const signals: string[] = [];
  feed.subscribe(signal => signals.push(signal.scope));
  const finishes: unknown[] = [];
  const commands = {
    begin: async input => ({ ...input, operationId: 'seat:cyc-1:seat-1',
      runId: 'run-1', startedAt: 'now' }),
    finish: async input => { finishes.push(input); return { ...input, finished: true as const }; },
  } as CycloneCommands;
  const seats = Object.create(null) as CycloneSeatService;
  seats.require = async () => ({ id: 'seat-1', agentId: 'agent-reviewer',
    pending: {}, messages: [] }) as never;
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const runtime = Object.create(null) as CycloneSeatCompactionRuntime;
  const port = createCycloneSeatCompactionPort('data', seats, commands, executions, runtime, feed);

  await assert.rejects(() => port.prepare({ workshopId: 'cyc-1', seatId: 'seat-1' }),
    /存在挂起提问/);
  assert.deepEqual(finishes, [{ operationId: 'seat:cyc-1:seat-1', runId: 'run-1',
    status: 'failed', agentIds: ['agent-reviewer'],
    error: '该工位存在挂起提问，请先完成回答' }]);
  assert.deepEqual(signals, ['activity', 'activity']);
});
