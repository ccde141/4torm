import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { AgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
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

test('Agent 可通过中心工具调整与会顺序和成员并删除会议', async () => {
  const calls: string[] = [];
  const sessionPort = {
    ...sessions(),
    join: async (_id: string, agentId: string) => { calls.push(`join:${agentId}`); return [agentId]; },
    leave: async (_id: string, agentId: string) => { calls.push(`leave:${agentId}`); return []; },
    reorder: async (_id: string, ids: string[]) => { calls.push(`order:${ids.join(',')}`); return ids; },
    remove: async () => { calls.push('delete'); },
  } as ConvectionSessionService;
  const router = new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] }, commands: commands(), sessions: sessionPort,
  })]);
  const agent = { ...context, actor: { type: 'agent' as const, id: 'main',
    actingAs: 'human' as const }, audience: 'agent' as const,
    permissions: new Set(['design' as const, 'administer' as const]) };
  for (const [method, input] of [
    ['joinSession', { sessionId: 'conv-1', agentId: 'agent-c' }],
    ['reorderSession', { sessionId: 'conv-1', participantAgentIds: ['agent-c'] }],
    ['leaveSession', { sessionId: 'conv-1', agentId: 'agent-c' }],
    ['deleteSession', { sessionId: 'conv-1' }],
  ] as const) await router.invoke({ feature: 'convection', method, input }, agent);
  assert.deepEqual(calls, ['join:agent-c', 'order:agent-c', 'leave:agent-c', 'delete']);
});

test('Agent 一次开启对流后获得会议闭环工具，关闭后旧上下文调用被拒绝', async () => {
  let enabled = true;
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([createConvectionModule({
    source: { snapshots: async () => [] }, commands: commands(), sessions: sessions(),
    discussions: { list: async () => ({ items: [], truncated: false }),
      read: async () => ({ messages: [], empty: true }) } as unknown as ConvectionDiscussionService,
    rounds: { start: async input => ({ ...input, runId: 'run-1',
      startedAt: '2026-09-30T00:00:00.000Z' }) } as ConvectionRoundService,
  })]), async () => ({ toolMode: 'selected',
    tools: enabled ? ['framework_capability_convection'] : [] }));
  const identity = { agentId: 'main' };
  const names = (await gateway.tools(identity)).map(tool => tool.name);
  for (const name of ['list_discussions', 'create_discussion', 'read_discussion',
    'list_discussion_rounds', 'read_discussion_round',
    'start_discussion', 'join_discussion', 'leave_discussion',
    'reorder_discussion', 'delete_discussion', 'wait_operation']) {
    assert.ok(names.includes(name), `${name} missing`);
  }
  await gateway.invokeTool('list_discussions', {}, identity);
  enabled = false;
  await assert.rejects(gateway.invokeTool('list_discussions', {}, identity), error =>
    (error as { data?: { code?: string } }).data?.code === 'CAPABILITY_DISABLED');
});

test('真实对流工厂在回复中向 Agent 暴露内存快照和空助理私聊', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-live-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createConvectionFeature({ dataDir });
  await seedAgents(dataDir);
  const room = await feature.sessions.create({ chairAgentId: 'chair-a',
    participantAgentIds: ['agent-a'] });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  feature.executor.speak = async (_session, _message, emit) => {
    emit?.({ type: 'agent-start', agentId: 'agent-a', label: '成员' });
    emit?.({ type: 'token', agentId: 'agent-a', label: '成员', chunk: '正在分析' });
    await pending;
  };
  const gateway = new AgentCollaborationGateway(new CollaborationRouter([feature.module]),
    async () => ({ toolMode: 'selected', tools: ['framework_capability_convection'] }));
  const identity = { agentId: 'main' };
  await gateway.invokeTool('start_discussion', { sessionId: room.id,
    message: '讨论架构' }, identity);
  const current = await gateway.invokeTool('read_discussion', { sessionId: room.id }, identity) as {
    messages: Array<{ content: string; complete?: boolean }>; notice?: string;
  };
  assert.equal(current.messages.at(-1)?.content, '正在分析');
  assert.equal(current.messages.at(-1)?.complete, false);
  assert.match(current.notice ?? '', /尚未完全回复完成/);
  const rounds = await gateway.invokeTool('list_discussion_rounds', {
    sessionId: room.id,
  }, identity) as { items: Array<{ roundId: string; status: string }> };
  assert.equal(rounds.items[0]?.status, 'running');
  const round = await gateway.invokeTool('read_discussion_round', {
    sessionId: room.id, roundId: rounds.items[0]!.roundId,
  }, identity) as { messages: Array<{ content: string; complete?: boolean }> };
  assert.deepEqual(round.messages.map(message => message.content), ['讨论架构', '正在分析']);
  assert.equal(round.messages.at(-1)?.complete, false);
  const chair = await gateway.invokeTool('read_discussion', { sessionId: room.id,
    scope: 'chair' }, identity) as { messages: unknown[]; empty: boolean };
  assert.deepEqual(chair.messages, []);
  assert.equal(chair.empty, true);
  release();
  await feature.discussionRounds.drain();
});

test('会议助理回复失败后，已推送的私聊消息仍可读取', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-chair-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const feature = createConvectionFeature({ dataDir });
  await seedAgents(dataDir);
  const room = await feature.sessions.create({ chairAgentId: 'chair-a',
    participantAgentIds: ['agent-a'] });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), '{}');
  await feature.discussionRounds.start({ sessionId: room.id,
    round: 'chair', message: '请梳理当前争议' });
  await feature.discussionRounds.drain();
  const stored = await feature.sessions.require(room.id);
  assert.equal(stored.chairMessages[0]?.content, '请梳理当前争议');
  assert.match(stored.chairMessages[0]?.runId ?? '', /^convection-run-/);
});

async function seedAgents(dataDir: string): Promise<void> {
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'chair-a': { name: '会长' }, 'agent-a': { name: '成员' },
  }));
}

function commands(): ConvectionCommands {
  return {
    begin: async input => ({ ...input, runId: 'run-a', startedAt: '2026-09-30T00:00:00.000Z' }),
    finish: async input => ({ ...input, finished: true }),
    abort: async input => ({ ...input, stopped: true }),
  };
}

function sessions(): ConvectionSessionService {
  return {
    create: async input => ({ id: 'conv-new', title: input.title ?? '对流' } as never),
    list: async () => [], require: async () => ({} as never), save: async () => {},
    rename: async () => {}, join: async () => [], leave: async () => [], reorder: async () => [],
    setChair: async (_sessionId, agentId) => agentId, remove: async () => {},
    editMessage: async () => {}, deleteMessage: async () => {},
    resetContext: async (_sessionId, mode) => ({
      ok: true, mode, archived: '001.json', summaryFailed: false,
    }),
  } as ConvectionSessionService;
}
