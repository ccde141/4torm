import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { createConvectionModule } from './module.js';
import { createConvectionFeature } from './factory.js';
import type { ConvectionCommands } from '../application/round-commands.js';
import type { ConvectionSessionService } from '../application/session-service.js';
import type { ConvectionDiscussionService } from '../application/discussion-service.js';
import type { ConvectionRoundService } from '../application/round-service.js';

const context: CollaborationContext = {
  actor: { type: 'human', id: 'human', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['convection']), permissions: new Set(['observe']), requestId: 'req-1',
};

test('对流只把会话摘要和当前轮次身份投影到统一探针', async () => {
  const router = new CollaborationRouter([createConvectionModule({ source: {
    snapshots: async () => [{
      sessionId: 'conv-1', title: '架构评审', updatedAt: '2026-09-30T01:02:03.000Z',
      activeRound: {
        round: 'chair', runId: 'convection-run-1', startedAt: '2026-09-30T01:00:00.000Z',
      },
    }, {
      sessionId: 'conv-2', title: '空闲讨论', updatedAt: '2026-09-29T01:02:03.000Z',
      activeRound: null,
    }],
  }, commands: commands(), sessions: sessions() })]);

  const result = await router.observe('convection', { view: 'summary' }, context);
  assert.deepEqual(result.items, [{
    operationId: 'conv-1', title: '架构评审', status: 'running',
    phase: 'chair', runId: 'convection-run-1', updatedAt: '2026-09-30T01:00:00.000Z',
  }, {
    operationId: 'conv-2', title: '空闲讨论', status: 'idle',
    updatedAt: '2026-09-29T01:02:03.000Z',
  }]);
});

test('对流探针按预算分页且不暴露消息内容', async () => {
  const source = {
    snapshots: async () => ['3', '2', '1'].map(id => ({
      sessionId: `conv-${id}`, title: `会议 ${id}`,
      updatedAt: `2026-09-${id.padStart(2, '0')}T00:00:00.000Z`, activeRound: null,
    })),
  };
  const router = new CollaborationRouter([createConvectionModule({
    source, commands: commands(), sessions: sessions(),
  })]);
  const first = await router.observe('convection', { limit: 2 }, context);
  assert.deepEqual(first.items.map(item => item.operationId), ['conv-3', 'conv-2']);
  assert.equal(first.truncated, true);
  assert.ok(first.nextCursor);

  const second = await router.observe('convection', { limit: 2, cursor: first.nextCursor }, context);
  assert.deepEqual(second.items.map(item => item.operationId), ['conv-1']);
  assert.equal(second.truncated, false);
});

test('对流没有活动轮次时投影最近的持久终态', async () => {
  const router = new CollaborationRouter([createConvectionModule({ source: {
    snapshots: async () => [{
      sessionId: 'conv-1', title: '讨论', updatedAt: '2026-09-30T01:00:00.000Z',
      activeRound: null,
      lastRound: {
        sessionId: 'conv-1', runId: 'run-1', round: 'public', status: 'failed',
        startedAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:01:00.000Z',
        error: '模型请求失败',
      },
    }],
  }, commands: commands(), sessions: sessions() })]);
  const result = await router.observe('convection', { view: 'summary' }, context);
  assert.deepEqual(result.items, [{
    operationId: 'conv-1', title: '讨论', status: 'failed', phase: 'public',
    runId: 'run-1', updatedAt: '2026-09-30T00:01:00.000Z',
    errorMessage: '模型请求失败',
  }]);
});

test('对流只按轮次身份通过中心调用口中止执行', async () => {
  const calls: Array<{ sessionId: string; runId: string }> = [];
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] },
    commands: commands({ abort: async input => {
      calls.push(input);
      return { stopped: true, ...input };
    } }), sessions: sessions(),
  })]);
  const result = await router.invoke({
    feature: 'convection', method: 'abortRound',
    input: { sessionId: 'conv-1', runId: 'convection-run-1' },
  }, { ...context, permissions: new Set(['observe', 'intervene']) });

  assert.deepEqual(calls, [{ sessionId: 'conv-1', runId: 'convection-run-1' }]);
  assert.deepEqual(result, {
    stopped: true, sessionId: 'conv-1', runId: 'convection-run-1',
  });
});

test('对流不公开可绕过目的级轮次服务的开始与完成命令', () => {
  const module = createConvectionModule({
    source: { snapshots: async () => [] }, commands: commands(), sessions: sessions(),
  });
  assert.deepEqual(module.manifest.methods.map(method => method.id), [
    'listSessions', 'readSession',
    'abortRound', 'createSession', 'renameSession', 'joinSession', 'leaveSession',
    'reorderSession', 'setChair', 'deleteSession', 'editMessage', 'deleteMessage',
    'resetContext',
    'compactContext',
    'compactChairContext', 'resetChairContext',
  ]);
});

test('对流会话配置写入只通过中心声明的方法进入应用服务', async () => {
  const calls: string[] = [];
  const sessionPort = sessions({
    rename: async (sessionId, title) => { calls.push(`rename:${sessionId}:${title}`); },
    join: async (sessionId, agentId) => {
      calls.push(`join:${sessionId}:${agentId}`);
      return ['agent-a', agentId];
    },
    editMessage: async (sessionId, index, content) => {
      calls.push(`edit:${sessionId}:${index}:${content}`);
    },
    resetContext: async (sessionId, mode) => {
      calls.push(`reset:${sessionId}:${mode}`);
      return { ok: true, mode, archived: '001.json', summaryFailed: false };
    },
  });
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] }, commands: commands(), sessions: sessionPort,
  })]);
  const ctx = { ...context, permissions: new Set(['design'] as const) };
  assert.deepEqual(await router.invoke({ feature: 'convection', method: 'renameSession',
    input: { sessionId: 'conv-1', title: '新标题' } }, ctx), { ok: true });
  assert.deepEqual(await router.invoke({ feature: 'convection', method: 'joinSession',
    input: { sessionId: 'conv-1', agentId: 'agent-b' } }, ctx), {
    participantAgentIds: ['agent-a', 'agent-b'],
  });
  assert.deepEqual(await router.invoke({ feature: 'convection', method: 'editMessage',
    input: { sessionId: 'conv-1', index: 2, content: '修订' } }, ctx), { ok: true });
  assert.deepEqual(await router.invoke({ feature: 'convection', method: 'resetContext',
    input: { sessionId: 'conv-1', mode: 'clean' } }, {
    ...ctx, permissions: new Set(['administer']),
  }), { ok: true, mode: 'clean', archived: '001.json', summaryFailed: false });
  assert.deepEqual(calls, [
    'rename:conv-1:新标题', 'join:conv-1:agent-b', 'edit:conv-1:2:修订',
    'reset:conv-1:clean',
  ]);
});

test('对流工作区只通过中心管理方法打开', async () => {
  const calls: string[] = [];
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] }, commands: commands(), sessions: sessions(),
    workspace: { open: async sessionId => {
      calls.push(sessionId);
      return `workspace/${sessionId}`;
    } },
  })]);
  const result = await router.invoke({
    feature: 'convection', method: 'openWorkspace', input: { sessionId: 'conv-1' },
  }, { ...context, permissions: new Set(['administer']) });
  assert.deepEqual(result, { ok: true, path: 'workspace/conv-1' });
  assert.deepEqual(calls, ['conv-1']);
});

test('Agent 通过目的级工具创建可审查的对流会议', async () => {
  const calls: string[] = [];
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] }, commands: commands(), sessions: sessions(),
    discussions: {
      create: async input => {
        calls.push(`${input.title}:${input.chairAgentId}:${input.participantAgentIds.join(',')}`);
        return { sessionId: 'conv-new', title: input.title, topic: input.topic,
          chairAgentId: input.chairAgentId, participantAgentIds: input.participantAgentIds };
      },
    } as ConvectionDiscussionService,
  })]);
  const result = await router.invoke({ feature: 'convection', method: 'createDiscussion', input: {
    title: '架构讨论', topic: '确认模块边界', chairAgentId: 'chair-a',
    participantAgentIds: ['agent-a', 'agent-b'],
  } }, { ...context, actor: { type: 'agent', id: 'main', actingAs: 'human' },
    audience: 'agent', permissions: new Set(['design']) });
  assert.deepEqual(calls, ['架构讨论:chair-a:agent-a,agent-b']);
  assert.deepEqual(result, {
    sessionId: 'conv-new', title: '架构讨论', topic: '确认模块边界',
    chairAgentId: 'chair-a', participantAgentIds: ['agent-a', 'agent-b'],
  });
});

test('Agent 启动对流轮次时获得中心验证的运行句柄', async () => {
  let active = false;
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => active ? [{
      sessionId: 'conv-1', title: '讨论', updatedAt: '2026-09-30T00:00:00.000Z',
      activeRound: { round: 'public', runId: 'run-1', startedAt: '2026-09-30T00:00:00.000Z' },
    }] : [] }, commands: commands(), sessions: sessions(),
    rounds: { start: async input => {
      active = true;
      return { ...input, runId: 'run-1', startedAt: '2026-09-30T00:00:00.000Z' };
    } } as ConvectionRoundService,
  })]);
  const result = await router.invoke({ feature: 'convection', method: 'startDiscussion', input: {
    sessionId: 'conv-1', round: 'public', message: '评审接口边界',
  } }, { ...context, actor: { type: 'agent', id: 'main', actingAs: 'human' },
    audience: 'agent', permissions: new Set(['execute']) });
  assert.deepEqual(result, {
    operationId: 'conv-1', sessionId: 'conv-1', round: 'public',
    runId: 'run-1', startedAt: '2026-09-30T00:00:00.000Z',
  });
});

test('Agent 只能通过有界读取口取得对流公共记录', async () => {
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] }, commands: commands(), sessions: sessions(),
    discussions: {
      read: async (sessionId, budget) => ({ sessionId, budget }),
    } as unknown as ConvectionDiscussionService,
  })]);
  const result = await router.invoke({ feature: 'convection', method: 'readDiscussion',
    input: { sessionId: 'conv-1' }, budget: { items: 2, textChars: 100, textLines: 5 },
  }, { ...context, actor: { type: 'agent', id: 'main', actingAs: 'human' },
    audience: 'agent', permissions: new Set(['observe']) });
  assert.deepEqual(result, { sessionId: 'conv-1', budget: {
    items: 2, textChars: 100, textLines: 5,
  } });
});

test('对流轮次终态通过中心等待口唤醒同一 runId', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-wait-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createConvectionFeature({ dataDir });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'chair-a': { name: '会长' }, 'agent-a': { name: '成员' },
  }));
  const router = new CollaborationRouter([feature.module]);
  const session = await feature.sessions.create({
    chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
  });
  let release!: () => void;
  feature.executor.speak = async () => new Promise<void>(resolve => { release = resolve; });
  const run = await feature.discussionRounds.start({
    sessionId: session.id, round: 'public', message: '开始',
  });
  const waiting = router.waitOperation('convection', {
    operationId: run.sessionId, runId: run.runId,
  }, context, 1_000);
  release();
  assert.equal((await waiting).fact.status, 'completed');
});

test('对流新轮次开始后旧句柄仍可通过中心读取', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'convection-old-handle-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createConvectionFeature({ dataDir });
  await feature.runs.start({ sessionId: 'conv-a', runId: 'run-a', round: 'public',
    startedAt: '2026-09-30T00:00:00.000Z' });
  await feature.runs.finish('conv-a', 'run-a', 'completed');
  await feature.runs.start({ sessionId: 'conv-a', runId: 'run-b', round: 'chair',
    startedAt: '2026-09-30T01:00:00.000Z' });
  const router = new CollaborationRouter([feature.module]);
  assert.equal((await router.inspectOperation('convection', {
    operationId: 'conv-a', runId: 'run-a',
  }, context)).status, 'completed');
  assert.equal((await router.inspectOperation('convection', {
    operationId: 'conv-a', runId: 'run-b',
  }, context)).status, 'running');
});

function commands(overrides: Partial<ConvectionCommands> = {}): ConvectionCommands {
  return {
    begin: async input => ({
      ...input, runId: 'convection-run-default', startedAt: '2026-09-30T00:00:00.000Z',
    }),
    finish: async input => ({ finished: true, ...input }),
    abort: async input => ({ stopped: true, ...input }),
    ...overrides,
  };
}

function sessions(
  overrides: Partial<ConvectionSessionService> = {},
): ConvectionSessionService {
  return {
    create: async input => ({ id: 'conv-new', title: input.title ?? '对流' } as never),
    list: async () => [], require: async () => ({} as never), save: async () => {},
    rename: async () => {}, join: async () => [], leave: async () => [], reorder: async () => [],
    setChair: async (_sessionId, agentId) => agentId, remove: async () => {},
    editMessage: async () => {}, deleteMessage: async () => {},
    resetContext: async (_sessionId, mode) => ({
      ok: true, mode, archived: '001.json', summaryFailed: false,
    }),
    ...overrides,
  } as ConvectionSessionService;
}
