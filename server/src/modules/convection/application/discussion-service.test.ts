import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { ConvectionSessionService } from './session-service.js';
import { ConvectionDiscussionService } from './discussion-service.js';
import { sessionWorkspace } from '../infrastructure/session-store.js';
import { ConvectionRunRepository } from '../infrastructure/run-repository.js';

test('对流目的级创建在写入前核实全部 Agent', async () => {
  const root = await dataDir();
  let writes = 0;
  try {
    const service = new ConvectionDiscussionService(root, sessions(() => { writes += 1; }));
    await assert.rejects(() => service.create({
      title: '讨论', topic: '架构', chairAgentId: 'chair-a',
      participantAgentIds: ['missing'],
    }), code('CONVECTION_DISCUSSION_AGENT_NOT_FOUND'));
    assert.equal(writes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('对流目的级创建拒绝重复成员并返回真实会话身份', async () => {
  const root = await dataDir();
  try {
    const service = new ConvectionDiscussionService(root, sessions());
    await assert.rejects(() => service.create({
      title: '讨论', topic: '架构', chairAgentId: 'chair-a',
      participantAgentIds: ['agent-a', 'agent-a'],
    }), code('CONVECTION_DISCUSSION_MEMBER_INVALID'));
    const result = await service.create({
      title: '讨论', topic: '架构', chairAgentId: 'chair-a',
      participantAgentIds: ['agent-a'],
    });
    assert.deepEqual(result, {
      sessionId: 'conv-new', title: '讨论', topic: '架构',
      chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('对流读取口只返回有界公共内容，不暴露推理与工具记录', async () => {
  const root = await dataDir();
  try {
    const service = new ConvectionDiscussionService(root, {
      require: async () => ({
        id: 'conv-a', title: '讨论', topic: '架构', chairAgentId: 'chair-a',
        participantAgentIds: ['agent-a'], publicMessages: [
          { speaker: '人类', content: '第一条很长的消息', timestamp: 1, reasoning: 'private' },
          { speaker: '成员', content: '第二条结论', timestamp: 2, toolCalls: [] },
        ],
      }),
    } as ConvectionSessionService);
    const result = await service.read('conv-a', { items: 1, textChars: 100, textLines: 10 });
    assert.deepEqual(result.messages, [{ speaker: '成员', content: '第二条结论', timestamp: 2 }]);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(JSON.stringify(result).includes('toolCalls'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('会议助理记录为空时明确返回空列表；运行中可读取未落盘的最新文字', async () => {
  const root = await dataDir();
  try {
    const session = {
      id: 'conv-a', title: '讨论', topic: '架构', chairAgentId: 'chair-a',
      participantAgentIds: ['agent-a'], publicMessages: [
        { speaker: '人类', content: '开始', timestamp: 1 },
      ], chairMessages: [], createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const service = new ConvectionDiscussionService(root, {
      require: async () => structuredClone(session),
    } as ConvectionSessionService, () => ({
      session, round: 'public', runId: 'run-1', speaker: '成员', draft: '正在输出',
    }));
    const publicView = await service.read('conv-a', { items: 10, textChars: 100,
      textLines: 10 });
    assert.equal(publicView.activeRound?.runId, 'run-1');
    assert.equal(publicView.messages.at(-1)?.content, '正在输出');
    assert.equal(publicView.messages.at(-1)?.complete, false);
    assert.match(publicView.notice ?? '', /尚未完全回复完成/);
    const tiny = await service.read('conv-a', { items: 10, textChars: 2,
      textLines: 1 });
    assert.equal(tiny.messages.at(-1)?.content, '输出');
    assert.equal(tiny.truncated, true);
    const chairView = await service.read('conv-a', { items: 10, textChars: 100,
      textLines: 10 }, 'chair');
    assert.deepEqual(chairView.messages, []);
    assert.equal(chairView.empty, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('会议目录按页返回 ID、参与顺序与主题', async () => {
  const root = await dataDir();
  try {
    const service = new ConvectionDiscussionService(root, {
      list: async () => ['a', 'b'].map(id => ({ id: `conv-${id}`, title: id,
        topic: '架构', chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
        messageCount: 1, tokenEstimate: 1, createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: `2026-01-0${id === 'a' ? '2' : '1'}T00:00:00.000Z`,
      })),
    } as ConvectionSessionService);
    const first = await service.list({ items: 1 });
    assert.deepEqual(first.items.map(item => item.sessionId), ['conv-a']);
    assert.ok(first.nextCursor);
    assert.deepEqual((await service.list({ items: 1 }, first.nextCursor)).items
      .map(item => item.sessionId), ['conv-b']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('按公开轮次列出并读取消息，进行中的轮次包含未完成草稿', async () => {
  const root = await dataDir();
  try {
    const session = {
      id: 'conv-a', title: '讨论', topic: '架构', chairAgentId: 'chair-a',
      participantAgentIds: ['agent-a'], chairMessages: [],
      publicMessages: [
        { speaker: '人类', content: '第一问', timestamp: 1, runId: 'run-1' },
        { speaker: '成员', content: '第一答', timestamp: 2, runId: 'run-1' },
        { speaker: '人类', content: '第二问', timestamp: 3, runId: 'run-2' },
      ],
    };
    const service = new ConvectionDiscussionService(root, {
      require: async () => session,
    } as unknown as ConvectionSessionService, () => ({
      session, round: 'public', runId: 'run-2', speaker: '成员', draft: '正在回答',
    }));
    const rounds = await service.listRounds('conv-a', 'public', { items: 1 });
    assert.deepEqual(rounds.items.map(item => item.roundId), ['run-2']);
    assert.equal(rounds.items[0]?.complete, false);
    assert.ok(rounds.nextCursor);
    assert.deepEqual((await service.listRounds('conv-a', 'public', { items: 1 },
      rounds.nextCursor)).items.map(item => item.roundId), ['run-1']);
    const read = await service.readRound('conv-a', 'run-2', 'public',
      { items: 10, textChars: 100, textLines: 10 });
    assert.deepEqual(read.messages.map(message => message.content), ['第二问', '正在回答']);
    assert.equal(read.messages.at(-1)?.complete, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('旧消息可按发话边界读取，私聊独立成轮且空记录明确返回', async () => {
  const root = await dataDir();
  try {
    const service = new ConvectionDiscussionService(root, {
      require: async () => ({ id: 'conv-a', title: '讨论', topic: '架构',
        chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
        publicMessages: [
          { speaker: '人类', content: '旧问题', timestamp: 1 },
          { speaker: '成员', content: '旧回答', timestamp: 2 },
        ],
        chairMessages: [
          { role: 'user', content: '私聊问题', runId: 'chair-1' },
          { role: 'assistant', content: '私聊回答', runId: 'chair-1' },
        ],
      }),
    } as unknown as ConvectionSessionService);
    const legacy = await service.listRounds('conv-a', 'public', { items: 10 });
    assert.equal(legacy.items.length, 1);
    assert.equal(legacy.items[0]?.preciseIdentity, false);
    const older = await service.readRound('conv-a', legacy.items[0]!.roundId,
      'public', { items: 10, textChars: 100, textLines: 10 });
    assert.deepEqual(older.messages.map(message => message.content), ['旧问题', '旧回答']);
    const chair = await service.readRound('conv-a', 'chair-1', 'chair',
      { items: 10, textChars: 100, textLines: 10 });
    assert.deepEqual(chair.messages.map(message => message.content), ['私聊问题', '私聊回答']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('压缩与清空归档中的原文仍能按轮读取，摘要不冒充轮次', async () => {
  const root = await dataDir();
  try {
    const archiveDir = path.join(sessionWorkspace(root, 'conv-a'), 'bak');
    await mkdir(archiveDir, { recursive: true });
    await writeFile(path.join(archiveDir, '001.json'), JSON.stringify([
      { speaker: '人类', content: '归档问题', timestamp: 1, runId: 'run-1' },
      { speaker: '成员', content: '归档回答', timestamp: 2, runId: 'run-1' },
    ]));
    await writeFile(path.join(archiveDir, '002.json'), JSON.stringify({
      publicMessages: [{ speaker: '人类', content: '清空前问题', timestamp: 3 }],
      chairMessages: [{ role: 'user', content: '清空前私聊', runId: 'chair-1' }],
    }));
    const service = new ConvectionDiscussionService(root, {
      require: async () => ({ id: 'conv-a', title: '讨论', topic: '架构',
        chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
        publicMessages: [{ speaker: '系统', content: '[对话历史摘要]\n压缩内容', timestamp: 4 }],
        chairMessages: [],
      }),
    } as unknown as ConvectionSessionService);
    const listed = await service.listRounds('conv-a', 'public', { items: 10 });
    assert.equal(listed.items.length, 2);
    assert.equal(listed.items.some(item => item.opening.includes('压缩内容')), false);
    const archived = await service.readRound('conv-a', 'run-1', 'public',
      { items: 10, textChars: 100, textLines: 10 });
    assert.deepEqual(archived.messages.map(message => message.content), ['归档问题', '归档回答']);
    assert.equal(archived.archived, true);
    const chair = await service.readRound('conv-a', 'chair-1', 'chair',
      { items: 10, textChars: 100, textLines: 10 });
    assert.equal(chair.messages[0]?.content, '清空前私聊');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('失败轮次保留已写入的发话，并明确不是完整回复', async () => {
  const root = await dataDir();
  try {
    const runs = new ConvectionRunRepository(root);
    await runs.start({ sessionId: 'conv-a', runId: 'run-failed', round: 'public',
      startedAt: '2026-09-30T00:00:00.000Z' });
    await runs.finish('conv-a', 'run-failed', 'failed', '模型失败');
    const service = new ConvectionDiscussionService(root, {
      require: async () => ({ id: 'conv-a', title: '讨论', topic: '架构',
        chairAgentId: 'chair-a', participantAgentIds: ['agent-a'],
        publicMessages: [{ speaker: '人类', content: '讨论问题', timestamp: 1,
          runId: 'run-failed' }], chairMessages: [],
      }),
    } as unknown as ConvectionSessionService, undefined, runs);
    const listed = await service.listRounds('conv-a', 'public', { items: 10 });
    assert.equal(listed.items[0]?.status, 'failed');
    assert.equal(listed.items[0]?.complete, false);
    const read = await service.readRound('conv-a', 'run-failed', 'public',
      { items: 10, textChars: 100, textLines: 10 });
    assert.equal(read.complete, false);
    assert.equal(read.messages[0]?.content, '讨论问题');
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function dataDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convection-discussion-'));
  await mkdir(path.dirname(agentRegistryFile(root)), { recursive: true });
  await writeFile(agentRegistryFile(root), JSON.stringify({
    'chair-a': { id: 'chair-a', name: '主席', model: 'test' },
    'agent-a': { id: 'agent-a', name: '成员', model: 'test' },
  }));
  return root;
}

function sessions(onCreate: () => void = () => {}): ConvectionSessionService {
  return {
    create: async input => {
      onCreate();
      return { id: 'conv-new', title: input.title, topic: input.topic,
        chairAgentId: input.chairAgentId, participantAgentIds: input.participantAgentIds } as never;
    },
  } as ConvectionSessionService;
}

function code(expected: string): (error: unknown) => boolean {
  return error => error instanceof FrameworkError && error.data.code === expected;
}
