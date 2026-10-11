import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollaborationRouter } from './router.js';
import { invokeCoordinationTool } from './coordination-tools.js';

test('等待工具接受模型常见的十进制字符串超时值', async () => {
  let timeout: number | undefined;
  const router = {
    waitOperation: async (_feature: unknown, _identity: unknown, _context: unknown, timeoutMs: number) => {
      timeout = timeoutMs;
      return { fact: { operationId: 'wf-a', runId: 'run-a', title: '发布', status: 'completed' },
        timedOut: false };
    },
  } as unknown as CollaborationRouter;
  const context = { actor: { type: 'agent' as const, id: 'agent-a', actingAs: 'human' as const },
    audience: 'agent' as const, enabledFeatures: new Set(), permissions: new Set(['observe' as const]),
    requestId: 'session-a' };

  const result = await invokeCoordinationTool(router, 'wait_operation', {
    feature: 'tradewind', operationId: 'wf-a', runId: 'run-a', timeoutMs: '30000',
  }, context);

  assert.equal(timeout, 30_000);
  assert.deepEqual(result, { feature: 'tradewind', operationId: 'wf-a', runId: 'run-a',
    title: '发布', status: 'completed', timedOut: false });
});

test('中心记录工具转发精确身份与分页预算', async () => {
  const received: unknown[] = [];
  const router = {
    listOperationRecords: async (...args: unknown[]) => {
      received.push(args);
      return { feature: 'tide', items: [], truncated: false };
    },
    readOperationRecord: async (...args: unknown[]) => {
      received.push(args);
      return { feature: 'tide', text: '记录', truncated: false };
    },
  } as unknown as CollaborationRouter;
  const context = { actor: { type: 'agent' as const, id: 'main', actingAs: 'human' as const },
    audience: 'agent' as const, enabledFeatures: new Set(),
    permissions: new Set(['observe' as const]), requestId: 'session-a' };
  await invokeCoordinationTool(router, 'find_operation_records', {
    feature: 'tide', operationId: 'task-a', limit: '2',
  }, context);
  await invokeCoordinationTool(router, 'read_operation_record', {
    feature: 'tide', operationId: 'task-a', runId: 'run-a',
    maxTextChars: '100', maxTextLines: '10',
  }, context);
  assert.equal((received[0] as unknown[])[0], 'tide');
  assert.deepEqual((received[0] as unknown[])[1], { operationId: 'task-a', limit: 2 });
  assert.deepEqual((received[1] as unknown[])[1], {
    operationId: 'task-a', runId: 'run-a',
  });
  assert.deepEqual((received[1] as unknown[])[2], {
    maxTextChars: 100, maxTextLines: 10,
  });
});
