import assert from 'node:assert/strict';
import test from 'node:test';
import { createTradewindModule } from '../../modules/tradewind/public.js';
import { CollaborationRouter } from './router.js';

const context = {
  actor: { type: 'agent' as const, id: 'main', actingAs: 'human' as const },
  audience: 'agent' as const, enabledFeatures: new Set(['tradewind' as const]),
  permissions: new Set(['observe' as const]), requestId: 'session-a',
};

test('中心记录口按时间分页且精确读取时只输出有界内容', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  module.manifest.operation!.records = true;
  module.records = {
    list: async () => [{ operationId: 'wf-a', runId: 'run-old',
      title: '旧执行', status: 'completed', timestamp: '2026-09-30T00:00:00.000Z' },
    { operationId: 'wf-a', runId: 'run-new', title: '新执行',
      status: 'failed', timestamp: '2026-10-01T00:00:00.000Z' }],
    read: async (_identity) => ({ log: 'A'.repeat(100) }),
  };
  const router = new CollaborationRouter([module]);
  const first = await router.listOperationRecords('tradewind', { limit: 1 }, context);
  assert.deepEqual(first.items.map(item => item.runId), ['run-new']);
  assert.ok(first.nextCursor);
  const second = await router.listOperationRecords('tradewind', {
    limit: 1, cursor: first.nextCursor,
  }, context);
  assert.deepEqual(second.items.map(item => item.runId), ['run-old']);
  const page = await router.readOperationRecord('tradewind', {
    operationId: 'wf-a', runId: 'run-old',
  }, { maxTextChars: 20, maxTextLines: 2 }, context);
  assert.ok(page.text.length <= 20);
  assert.ok(page.nextCursor);
  await assert.rejects(router.readOperationRecord('tradewind', {
    operationId: 'wf-a', runId: 'run-new',
  }, { maxTextChars: 20, maxTextLines: 2, cursor: page.nextCursor }, context));
});

test('缺失记录明确返回 not_found，输入不能夹带未知字段', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  module.manifest.operation!.records = true;
  module.records = { list: async () => [], read: async () => null };
  const router = new CollaborationRouter([module]);
  await assert.rejects(router.readOperationRecord('tradewind', {
    operationId: 'wf-a', runId: 'run-a',
  }, {}, context), (error: any) => error?.data?.kind === 'not_found');
  await assert.rejects(router.listOperationRecords('tradewind', {
    unexpected: true,
  } as never, context), (error: any) => error?.data?.code === 'RECORD_INPUT_INVALID');
});

test('记录索引可按 Agent 归属过滤，不能把无归属记录误算给某人', async () => {
  const module = createTradewindModule({
    source: { snapshots: async () => [] }, commands: {} as never,
  });
  module.manifest.operation!.records = true;
  module.records = {
    list: async () => [
      { operationId: 'wf-a', runId: 'run-a', title: 'A',
        status: 'completed', timestamp: '2026-10-01T00:00:00.000Z', agentId: 'agent-a' },
      { operationId: 'wf-b', runId: 'run-b', title: 'B',
        status: 'completed', timestamp: '2026-10-01T01:00:00.000Z', agentId: 'agent-b' },
      { operationId: 'wf-c', runId: 'run-c', title: 'C',
        status: 'completed', timestamp: '2026-10-01T02:00:00.000Z',
        agentIds: ['agent-a', 'agent-b'] },
    ],
    read: async () => null,
  };
  const router = new CollaborationRouter([module]);
  const result = await router.listOperationRecords('tradewind', { agentId: 'agent-a' }, context);
  assert.deepEqual(result.items.map(item => item.runId), ['run-c', 'run-a']);
  await assert.rejects(router.listOperationRecords('tradewind', {
    agentId: '../agent-a',
  }, context), (error: any) => error?.data?.code === 'RECORD_INPUT_INVALID');
});

test('控制台一次读取每位 Agent 最近的真实历史，不受全局前 50 条截断', async () => {
  const module = createTradewindModule({ source: { snapshots: async () => [] },
    commands: {} as never });
  module.manifest.operation!.records = true;
  module.records = { list: async () => [
    ...Array.from({ length: 60 }, (_, index) => ({ operationId: `wf-${index}`,
      runId: `run-${index}`, title: '其他 Agent', status: 'completed' as const,
      timestamp: `2026-10-01T00:${String(index).padStart(2, '0')}:00.000Z`,
      agentId: 'other' })),
    { operationId: 'wf-own', runId: 'run-own', title: '实际最近事项',
      status: 'failed' as const, timestamp: '2026-09-30T00:00:00.000Z',
      agentIds: ['agent-a'] },
  ], read: async () => null };
  const router = new CollaborationRouter([module]);
  const result = await router.latestAgentRecords(['agent-a'], context);
  assert.equal(result.items[0]?.record.operationId, 'wf-own');
  assert.deepEqual(result.failures, []);
  await assert.rejects(router.latestAgentRecords(['../agent-a'], context));
});
