import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { FrameworkError, frameworkErrorToHttp } from '../../../engine/shared/framework-error.js';
import { createMonsoonModule } from './module.js';

const context: CollaborationContext = {
  actor: { type: 'human', id: 'local-human', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['monsoon']), permissions: new Set(['observe', 'intervene']), requestId: 'request-a',
};

test('季风探针从会话标题口读取事实标题，并受观察预算截断', async () => {
  const item = { operationId: 'session-a', runId: 'run-a', agentId: 'agent-a',
    title: 'session-a', status: 'completed' as const };
  const source = { snapshot: () => ({ revision: 'r1', items: [item] }),
    findRun: () => item, subscribeRun: () => () => undefined, abort: async () => false };
  const titles = { titles: async (agentId: string) => {
    assert.equal(agentId, 'agent-a');
    return new Map([['session-a', '编程助手初次问候']]);
  } };
  const module = createMonsoonModule(source, { summary: async () => ({
    revision: 1, members: [], reports: [], truncated: false }) }, undefined, titles);
  const router = new CollaborationRouter([module]);
  const observed = await router.observe('monsoon', { limit: 10 }, context);
  assert.equal(observed.items[0]?.title, '编程助手初次问候');
  const bounded = await router.observe('monsoon',
    { limit: 10, maxTextChars: 4 }, context);
  assert.ok((bounded.items[0]?.title.length ?? 0) <= 4);
});

test('标题口只读取本页事项所属 Agent 的索引', async () => {
  const calls: string[] = [];
  const items = [
    { operationId: 'one', agentId: 'agent-a', title: 'one', status: 'completed' as const },
    { operationId: 'two', agentId: 'agent-b', title: 'two', status: 'completed' as const },
  ];
  const router = new CollaborationRouter([createMonsoonModule({
    snapshot: () => ({ revision: 'r1', items }),
    findRun: () => undefined, subscribeRun: () => () => undefined,
    abort: async () => false,
  }, { summary: async () => ({}) } as never, undefined, {
    titles: async agentId => { calls.push(agentId); return new Map(); },
  })]);
  await router.observe('monsoon', { limit: 1 }, context);
  assert.deepEqual(calls, ['agent-a']);
});

test('季风观察口返回受预算约束的运行态摘要且不泄露模型上下文', async () => {
  const items = [
    { operationId: 'session-a', runId: 'run-a', title: 'session-a', status: 'running' as const, phase: 'streaming' },
    { operationId: 'session-b', runId: 'run-b', title: 'session-b', status: 'waiting' as const, phase: 'human-input' },
  ];
  const stopped: string[] = [];
  const team = { summary: async () => ({ revision: 3, members: [], reports: [], truncated: false }) };
  const router = new CollaborationRouter([createMonsoonModule({ snapshot: () => ({
    revision: 'abc123',
    items,
  }), findRun: (sessionId, runId) => items.find(item =>
    item.operationId === sessionId && item.runId === runId),
  subscribeRun: () => () => undefined,
  abort: async (sessionId, runId) => { stopped.push(`${sessionId}:${runId}`); return true; } }, team)]);
  const result = await router.observe('monsoon', { limit: 1 }, context);
  assert.equal(result.items.length, 1);
  assert.equal(result.truncated, true);
  assert.ok(result.nextCursor);
  assert.equal(JSON.stringify(result).includes('messages'), false);

  const tiny = await router.observe('monsoon', { limit: 2, maxTextChars: 1, maxTextLines: 1 }, context);
  assert.equal(tiny.items.length, 1);
  assert.equal(tiny.items[0]?.title.length, 1);
  assert.equal(tiny.items[0]?.phase, undefined);

  const exact = await router.invoke({ feature: 'monsoon', method: 'getRun',
    input: { sessionId: 'session-a', runId: 'run-a' } }, context) as any;
  assert.deepEqual([exact.operationId, exact.runId, exact.status],
    ['session-a', 'run-a', 'running']);
  assert.equal((await router.inspectOperation(
    'monsoon', { operationId: 'session-a', runId: 'run-a' }, context,
  )).status, 'running');
  await assert.rejects(router.invoke({ feature: 'monsoon', method: 'getRun',
    input: { sessionId: 'session-a', runId: 'old-run' } }, context),
  (error: any) => error?.data?.code === 'MONSOON_RUN_NOT_FOUND');

  assert.deepEqual(await router.invoke({ feature: 'monsoon', method: 'stopRun',
    input: { sessionId: 'session-a', runId: 'run-a' } }, context),
  { accepted: true, sessionId: 'session-a', runId: 'run-a' });
  assert.deepEqual(stopped, ['session-a:run-a']);
  await assert.rejects(router.invoke({ feature: 'monsoon', method: 'stopRun',
    input: { sessionId: 'session-a', runId: 'old-run' } }, context),
  (error: any) => error?.data?.code === 'MONSOON_RUN_NOT_FOUND');
  assert.deepEqual(await router.invoke({ feature: 'monsoon', method: 'getTeam',
    input: { agentId: 'agent-a', sessionId: 'session-a' } }, context),
  { revision: 3, members: [], reports: [], truncated: false });
});

test('当前运行查询只读 runtime snapshot，缺失时不回退历史记录', async () => {
  const current = { operationId: 'session-a', runId: 'run-new', agentId: 'agent-a',
    title: 'session-a', status: 'waiting' as const, phase: 'human-input' };
  let items = [current];
  let historicalReads = 0;
  const old = { ...current, runId: 'run-old', status: 'completed' as const };
  const source = { snapshot: () => ({ revision: 'r1', items }),
    findRun: () => { historicalReads++; return old; },
    subscribeRun: () => () => undefined, abort: async () => false };
  const runs = { getRun: async () => { historicalReads++; return old; },
    history: async () => { historicalReads++; return [old]; } } as never;
  const module = createMonsoonModule(source, { summary: async () => ({}) } as never, runs);
  const router = new CollaborationRouter([module]);
  const input = { sessionId: 'session-a' };
  assert.deepEqual(await router.invoke({ feature: 'monsoon', method: 'getCurrentRun', input }, context), current);
  assert.deepEqual(await router.invoke({ feature: 'monsoon', method: 'getCurrentRun', input },
    { ...context, audience: 'internal' }), current);
  assert.equal(historicalReads, 0);

  items = [];
  await assert.rejects(router.invoke({ feature: 'monsoon', method: 'getCurrentRun', input }, context),
    (error: unknown) => error instanceof FrameworkError
      && error.data.code === 'MONSOON_CURRENT_RUN_NOT_FOUND'
      && frameworkErrorToHttp(error).statusCode === 404);
  assert.equal(historicalReads, 0);
  await assert.rejects(router.invoke({ feature: 'monsoon', method: 'getCurrentRun',
    input: { ...input, runId: 'run-old' } }, context),
  (error: unknown) => error instanceof FrameworkError && error.data.code === 'FEATURE_INPUT_INVALID');
  const agent: CollaborationContext = { ...context, audience: 'agent',
    actor: { type: 'agent', id: 'agent-a', actingAs: 'human' } };
  assert.equal(router.listManifests(agent)[0]?.methods.some(method => method.id === 'getCurrentRun'), false);
  await assert.rejects(router.invoke({ feature: 'monsoon', method: 'getCurrentRun', input }, agent),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'CAPABILITY_AUDIENCE_DENIED');
});
