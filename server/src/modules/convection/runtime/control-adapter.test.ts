import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConvectionRunRepository } from '../infrastructure/run-repository.js';
import { createConvectionCommands } from './control-adapter.js';
import { ConvectionRoundRegistry } from './round-registry.js';

test('对流运行记录启动失败时释放已取得的轮次锁', async () => {
  let locked = false;
  const rounds = new ConvectionRoundRegistry(() => {
    if (locked) return null;
    locked = true;
    return () => { locked = false; };
  });
  const commands = createConvectionCommands(rounds, {
    start: async () => { throw new Error('disk failed'); },
  } as unknown as ConvectionRunRepository);
  await assert.rejects(commands.begin({ sessionId: 'conv-a', round: 'public' }), /disk failed/);
  assert.equal(locked, false);
  assert.doesNotThrow(() => rounds.begin('conv-a', 'public'));
});

test('对流终态写入失败仍释放轮次锁并真实抛错', async () => {
  let locked = false;
  const rounds = new ConvectionRoundRegistry(() => {
    if (locked) return null;
    locked = true;
    return () => { locked = false; };
  });
  const commands = createConvectionCommands(rounds, {
    start: async input => ({ ...input, status: 'running', updatedAt: input.startedAt }),
    finish: async () => { throw new Error('terminal write failed'); },
  } as unknown as ConvectionRunRepository);
  const receipt = await commands.begin({ sessionId: 'conv-a', round: 'public' });
  await assert.rejects(commands.finish({
    sessionId: receipt.sessionId, runId: receipt.runId, status: 'failed',
  }), /terminal write failed/);
  assert.equal(locked, false);
  assert.equal(rounds.snapshot('conv-a'), null);
});
