import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneChairService } from '../application/chair-service.js';
import { createCycloneChairChatPort } from './chair-chat-adapter.js';

test('会长模型失败由内部端口保存 failed 并释放执行身份', async () => {
  const finishes: unknown[] = [];
  let startedAgent: string | undefined;
  let inputIdentity: unknown;
  const commands = {
    begin: async input => {
      startedAgent = input.agentId;
      return { ...input, operationId: 'room:cyc-1:room-1',
        runId: 'run-1', startedAt: 'now' };
    },
    finish: async input => { finishes.push(input); return { ...input, finished: true as const }; },
  } as CycloneCommands;
  const chair = Object.create(null) as CycloneChairService;
  chair.status = async () => ({ chairAgentId: 'chair-a', messages: [] });
  const executions = { signal: () => new AbortController().signal } as CycloneExecutionPort;
  const port = createCycloneChairChatPort(
    'data', chair, commands, executions,
    async (_data, _workshop, _room, _text, _emit, _signal, identity) => {
      inputIdentity = identity;
      throw new Error('model failed');
    },
  );

  const prepared = await port.prepare({ workshopId: 'cyc-1', roomId: 'room-1', message: '检查' });
  assert.equal(startedAgent, 'chair-a');
  await assert.rejects(() => prepared.run(), /model failed/);
  assert.deepEqual(inputIdentity, { inputMessageId: 'run-1' });
  assert.deepEqual(finishes, [{ operationId: 'room:cyc-1:room-1', runId: 'run-1',
    status: 'failed', error: 'model failed' }]);
});
