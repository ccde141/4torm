import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { ImageDraft } from './image-attachments';
import { submitMonsoonTurn, type SubmitTurnPorts } from './submit-turn';

const agent: Agent = {
  id: 'agent-a', name: '季风', role: '', status: 'idle', model: 'model-a', description: '',
  createdAt: 'now', updatedAt: 'now', tasksCompleted: 0,
};
const session = {
  id: 'agent-a-session-a', agentId: agent.id, agentName: agent.name, title: '新会话', messages: [],
  model: agent.model, systemPrompt: '', createdAt: 'now', updatedAt: 'now',
} satisfies ChatSession;

function ports(overrides: Partial<SubmitTurnPorts> = {}): SubmitTurnPorts {
  return {
    hasRunner: () => false,
    presentRunner: () => undefined,
    createSession: async () => structuredClone(session),
    loadSession: async () => structuredClone(session),
    deleteImage: async () => undefined,
    uploadImage: async () => ({ id: 'image-a', name: 'a.png', mimeType: 'image/png', size: 1 }),
    generateMessageId: () => 'message-a',
    prepared: () => undefined,
    rollback: () => undefined,
    sessionCreated: () => undefined,
    launch: () => true,
    reportError: () => undefined,
    ...overrides,
  };
}

test('plain text is prepared synchronously before a new session finishes creating', async () => {
  let resolveSession!: (value: ChatSession) => void;
  const waiting = new Promise<ChatSession>(resolve => { resolveSession = resolve; });
  const order: string[] = [];
  let launchedMessages: ChatMessage[] = [];
  const completion = submitMonsoonTurn({
    agent, model: agent.model, sessionId: null, text: '立即显示', drafts: [], messages: [],
  }, ports({
    createSession: async () => { order.push('create'); return waiting; },
    prepared: value => { order.push('prepared'); assert.equal(value.message.content, '立即显示'); },
    sessionCreated: () => order.push('session-created'),
    launch: value => { order.push('launch'); launchedMessages = value.messages; return true; },
  }));

  assert.deepEqual(order, ['prepared', 'create']);
  resolveSession(structuredClone(session));
  assert.equal(await completion, 'launched');
  assert.deepEqual(order, ['prepared', 'create', 'session-created', 'launch']);
  assert.equal(launchedMessages.at(-1)?.content, '立即显示');
});

test('partial image upload preserves the new session and removes only this batch', async () => {
  const draft = (key: string) => ({ key, name: `${key}.png`, mimeType: 'image/png', size: 1,
    dataUrl: 'data:image/png;base64,AA==' }) satisfies ImageDraft;
  let uploads = 0;
  let prepared = 0;
  let launched = 0;
  let created = 0;
  const deleted: string[] = [];
  let reported = '';
  const result = await submitMonsoonTurn({
    agent, model: agent.model, sessionId: null, text: '带图', drafts: [draft('a'), draft('b')], messages: [],
  }, ports({
    uploadImage: async () => {
      if (++uploads === 2) throw new Error('disk full');
      return { id: 'image-a', name: 'a.png', mimeType: 'image/png', size: 1 };
    },
    prepared: () => { prepared++; },
    launch: () => { launched++; return true; },
    sessionCreated: () => { created++; },
    deleteImage: async (_agentId, _sessionId, attachmentId) => { deleted.push(attachmentId); },
    reportError: error => { reported = String(error); },
  }));

  assert.equal(result, 'failed');
  assert.equal(prepared, 0);
  assert.equal(launched, 0);
  assert.equal(created, 1);
  assert.deepEqual(deleted, ['image-a']);
  assert.match(reported, /disk full/);
});

test('an existing runner wins before session or attachment work begins', async () => {
  const calls: string[] = [];
  const result = await submitMonsoonTurn({
    agent, model: agent.model, sessionId: session.id, text: '重复', drafts: [], messages: [],
  }, ports({
    hasRunner: () => true,
    presentRunner: () => calls.push('present'),
    loadSession: async () => { calls.push('load'); return session; },
    prepared: () => calls.push('prepared'),
  }));
  assert.equal(result, 'occupied');
  assert.deepEqual(calls, ['present']);
});

test('stale text submission rebases its optimistic message on persisted external append', async () => {
  const original = { id: 'old', role: 'user', content: '原消息', timestamp: 'now' } satisfies ChatMessage;
  const appended = { id: 'tide', role: 'assistant', content: '潮汐追加', timestamp: 'now' } satisfies ChatMessage;
  const prepared: ChatMessage[][] = [];
  let launched: ChatMessage[] = [];
  const result = await submitMonsoonTurn({
    agent, model: agent.model, sessionId: session.id, text: '继续', drafts: [], messages: [original],
  }, ports({
    loadSession: async () => ({ ...session, revision: 5, messages: [original, appended] }),
    prepared: turn => prepared.push(turn.messages),
    launch: turn => { launched = turn.messages; return true; },
  }));

  assert.equal(result, 'launched');
  assert.deepEqual(prepared[0]?.map(message => message.id), ['old', 'message-a']);
  assert.deepEqual(prepared.at(-1)?.map(message => message.id), ['old', 'tide', 'message-a']);
  assert.deepEqual(launched.map(message => message.id), ['old', 'tide', 'message-a']);
});

test('stale image submission includes persisted external append', async () => {
  const appended = { id: 'tide-image', role: 'assistant', content: '后台消息', timestamp: 'now' } satisfies ChatMessage;
  const draft = { key: 'image', name: 'image.png', mimeType: 'image/png', size: 1,
    dataUrl: 'data:image/png;base64,AA==' } satisfies ImageDraft;
  let launched: ChatMessage[] = [];
  const result = await submitMonsoonTurn({
    agent, model: agent.model, sessionId: session.id, text: '看图', drafts: [draft], messages: [],
  }, ports({
    loadSession: async () => ({ ...session, revision: 5, messages: [appended] }),
    launch: turn => { launched = turn.messages; return true; },
  }));

  assert.equal(result, 'launched');
  assert.deepEqual(launched.map(message => message.id), ['tide-image', 'message-a']);
  assert.equal(launched.at(-1)?.images?.[0]?.id, 'image-a');
});

test('a deleted or reassigned session rolls back the optimistic message and never launches', async () => {
  let rollbacks = 0;
  let launches = 0;
  const result = await submitMonsoonTurn({
    agent, model: agent.model, sessionId: session.id, text: '不能丢失', drafts: [], messages: [],
  }, ports({
    loadSession: async () => ({ ...session, agentId: 'agent-b' }),
    rollback: (id, messages) => {
      assert.equal(id, session.id);
      assert.deepEqual(messages, []);
      rollbacks++;
    },
    launch: () => { launches++; return true; },
  }));
  assert.equal(result, 'failed');
  assert.equal(rollbacks, 1);
  assert.equal(launches, 0);
});
