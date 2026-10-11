import assert from 'node:assert/strict';
import test from 'node:test';
import type { MonsoonTurn } from '../runtime/turn-contract.js';
import { MonsoonTurnService } from './turn-service.js';

function turn(suspended = false): MonsoonTurn {
  return {
    isBusy: () => false, isSuspended: () => suspended, getAgentId: () => 'agent-a',
    getInputRuntime: () => null, abort: () => {},
    chat: async () => ({ content: 'ok', rawContent: 'ok' }),
    resume: async () => ({ content: 'ok', rawContent: 'ok' }),
  };
}

test('新轮次只有取得会话版本和持久日志后才交给 SSE', async () => {
  const runner = turn();
  const events: string[] = [];
  const service = new MonsoonTurnService({
    chat: { prepare: async () => ({
      runner, sessionId: 'session-a', inputRunId: 'run-a', agentId: 'agent-a',
      agentName: 'Agent A', effectiveModel: 'p:m', native: true,
      systemPrompt: 'SYSTEM', chatMessages: [],
    }) },
    runtime: runtime(runner, events),
    sessions: { get: async () => ({ messageRevision: 7 }), updateTokenUsage: async () => {} },
    journal: { begin: async (_agent, _session, _run, revision) => {
      events.push(`journal:${revision}`); return { append: async () => {} };
    } },
  });
  const execution = await service.start({
    sessionId: 'session-a', inputRunId: 'run-a', agentId: 'agent-a', messages: [],
  });
  assert.equal(execution.runId, 'run-a');
  assert.equal(execution.agentId, 'agent-a');
  assert.deepEqual(events, ['journal:7']);
});

test('each model usage is journaled and persisted before SSE may deliver it', async () => {
  const runner = turn();
  const order: string[] = [];
  const service = new MonsoonTurnService({
    chat: { prepare: async () => ({ runner, sessionId: 'session-a', inputRunId: 'run-a',
      agentId: 'agent-a', agentName: 'Agent A', effectiveModel: 'p:m', native: true,
      systemPrompt: 'SYSTEM', chatMessages: [] }) },
    runtime: runtime(runner, order),
    sessions: {
      get: async () => ({ messageRevision: 1 }),
      updateTokenUsage: async (_agent, _session, usage) => {
        order.push(`persist:${usage?.totalTokens ?? 'unknown'}`);
      },
    },
    journal: { begin: async () => ({ append: async event => {
      order.push(`journal:${(event as { type: string }).type}`);
    } }) },
  });
  const execution = await service.start({ sessionId: 'session-a', inputRunId: 'run-a',
    agentId: 'agent-a', messages: [] });
  await execution.record({ type: 'usage', usage: {
    promptTokens: 20, completionTokens: 2, totalTokens: 22,
  } });
  await execution.record({ type: 'usage', usage: null });
  assert.deepEqual(order, ['persist:22', 'journal:usage', 'persist:unknown', 'journal:usage']);
});

test('a journal failure keeps the actual usage and never reports a recorded event', async () => {
  const runner = turn();
  const order: string[] = [];
  const service = new MonsoonTurnService({
    chat: { prepare: async () => ({ runner, sessionId: 'session-a', inputRunId: 'run-a',
      agentId: 'agent-a', agentName: 'Agent A', effectiveModel: 'p:m', native: true,
      systemPrompt: 'SYSTEM', chatMessages: [] }) },
    runtime: runtime(runner, order),
    sessions: { get: async () => ({ messageRevision: 1 }),
      updateTokenUsage: async () => { order.push('persist'); } },
    journal: { begin: async () => ({ append: async () => {
      order.push('journal'); throw new Error('disk failure');
    } }) },
  });
  const execution = await service.start({ sessionId: 'session-a', inputRunId: 'run-a',
    agentId: 'agent-a', messages: [] });
  await assert.rejects(execution.record({ type: 'usage', usage: null }), /disk failure/);
  assert.deepEqual(order, ['persist', 'journal']);
});

test('持久日志启动失败会把已保留的轮次真实标为失败', async () => {
  const runner = turn();
  const events: string[] = [];
  const service = new MonsoonTurnService({
    chat: { prepare: async () => ({
      runner, sessionId: 'session-a', inputRunId: 'run-a', agentId: 'agent-a',
      agentName: 'Agent A', effectiveModel: 'p:m', native: true,
      systemPrompt: 'SYSTEM', chatMessages: [],
    }) },
    runtime: runtime(runner, events),
    sessions: { get: async () => null, updateTokenUsage: async () => {} },
    journal: { begin: async () => ({ append: async () => {} }) },
  });
  await assert.rejects(() => service.start({
    sessionId: 'session-a', inputRunId: 'run-a', agentId: 'agent-a', messages: [],
  }), /会话不存在/);
  assert.deepEqual(events, ['fail:run-a:MONSOON_JOURNAL_START_FAILED']);
});

test('恢复轮次拒绝不存在、未挂起和未取得独占权的会话', async () => {
  for (const [runner, claim, code] of [
    [undefined, false, 'MONSOON_SESSION_NOT_ACTIVE'],
    [turn(false), false, 'MONSOON_SESSION_NOT_SUSPENDED'],
    [turn(true), false, 'MONSOON_SESSION_BUSY'],
  ] as const) {
    const service = new MonsoonTurnService({
      chat: { prepare: async () => { throw new Error('unused'); } },
      runtime: {
        ...runtime(turn(), []), get: () => runner, claimResume: () => claim,
      },
      sessions: { get: async () => ({ messageRevision: 1 }), updateTokenUsage: async () => {} },
      journal: { begin: async () => ({ append: async () => {} }) },
    });
    await assert.rejects(() => service.resume('session-a', 'run-a', 'answer', 'waiting-new'),
      (error: any) => error?.data?.code === code);
  }
});

test('恢复轮次只接受当前 waiting runId，旧卡不得抢占新问题', async () => {
  const runner = turn(true);
  const events: string[] = [];
  const service = new MonsoonTurnService({
    chat: { prepare: async () => { throw new Error('unused'); } },
    runtime: { ...runtime(runner, events), getWaitingRunId: () => 'waiting-new' },
    sessions: { get: async () => ({ messageRevision: 1 }), updateTokenUsage: async () => {} },
    journal: { begin: async () => { events.push('journal'); return { append: async () => {} }; } },
  });
  await assert.rejects(() => service.resume('session-a', 'answer-run', '旧答案', 'waiting-old'),
    (error: any) => error?.data?.code === 'MONSOON_RUN_MISMATCH'
      && error?.data?.kind === 'conflict');
  assert.deepEqual(events, []);
  const execution = await service.resume('session-a', 'answer-run', '新答案', 'waiting-new');
  assert.deepEqual(execution.replyAcceptance, {
    type: 'reply-accepted', waitingRunId: 'waiting-new', answer: '新答案',
  });
  assert.deepEqual(events, ['claim', 'journal']);
});

function runtime(runner: MonsoonTurn, events: string[]) {
  return {
    get: () => runner,
    getWaitingRunId: () => 'waiting-new',
    claimResume: () => { events.push('claim'); return true; },
    fail: async (_session: string, _runner: MonsoonTurn, runId?: string,
      failure?: { code?: string }) => {
      events.push(`fail:${runId}:${failure?.code}`);
    },
  };
}
