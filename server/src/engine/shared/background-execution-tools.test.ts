import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { backgroundExecutions } from '../../services/background-execution.js';
import {
  executeBackgroundExecutionTool,
  executeBackgroundExecutionToolOutcome,
} from './background-execution-tools.js';

test('background execution outcome marks validation failure without changing string wrapper', async () => {
  const input = { tool: 'inspect_execution' as const, args: {},
    scope: 'conversation' as const, ownerId: 'test-owner' };
  const outcome = await executeBackgroundExecutionToolOutcome(input);
  assert.deepEqual(outcome, { result: '操作失败：缺少 executionId。', ok: false });
  assert.equal(await executeBackgroundExecutionTool(input), outcome.result);
});

test('background execution inspection succeeds even when completed job text contains failure words', async () => {
  const executionId = randomUUID();
  await backgroundExecutions.start({
    executionId, scope: 'conversation', ownerId: 'test-owner', label: 'test job',
    run: async () => '操作失败：这是任务产生的普通文本',
  });
  const outcome = await executeBackgroundExecutionToolOutcome({
    tool: 'inspect_execution', args: { executionId },
    scope: 'conversation', ownerId: 'test-owner',
  });
  assert.equal(outcome.ok, true);
  assert.match(outcome.result, /普通文本/);
});
