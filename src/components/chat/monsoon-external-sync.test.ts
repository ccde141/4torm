import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSession } from '../../store/chat';
import type { ChatMessage } from '../../types';
import { applyExternalSessionSnapshot, parseMonsoonSessionSignal,
  SessionRefreshBuffer } from './monsoon-external-sync';

const original = [{ id: 'old', role: 'user', content: '旧消息', timestamp: 'now' }] satisfies ChatMessage[];
const appended = { id: 'external', role: 'assistant', content: '外部追加', timestamp: 'now' } satisfies ChatMessage;

test('Monsoon selects only valid session invalidations from the Tide change contract', () => {
  assert.deepEqual(parseMonsoonSessionSignal(JSON.stringify({ type: 'change', scope: 'session',
    agentId: 'agent-a', sessionId: 'session-a', taskId: 'task-a', revision: 8 })),
  { agentId: 'agent-a', sessionId: 'session-a' });
  assert.equal(parseMonsoonSessionSignal(JSON.stringify({ type: 'change', scope: 'task',
    agentId: 'agent-a', taskId: 'task-a', revision: 9 })), null);
  assert.throws(() => parseMonsoonSessionSignal('{bad'), /JSON/);
  assert.throws(() => parseMonsoonSessionSignal(JSON.stringify({ type: 'change',
    scope: 'session', sessionId: 'session-a', revision: 10 })), /通知无效/);
});

test('external refresh applies durable messages only while its visible snapshot is current', async () => {
  let resolve!: (session: ChatSession) => void;
  const pending = new Promise<ChatSession>(done => { resolve = done; });
  let visible = original;
  let current = true;
  const applied: ChatMessage[][] = [];
  const ports = { load: async () => pending, currentMessages: () => visible,
    mayApply: () => current, apply: (messages: ChatMessage[]) => { applied.push(messages); } };
  const read = applyExternalSessionSnapshot('agent-a', 'session-a', ports);
  visible = [...original];
  resolve({ id: 'session-a', agentId: 'agent-a', messages: [...original, appended] } as ChatSession);
  await read;
  assert.deepEqual(applied, []);

  current = false;
  await applyExternalSessionSnapshot('agent-a', 'session-a', {
    ...ports, load: async () => assert.fail('busy session must not load'),
  });
  assert.deepEqual(applied, []);

  current = true;
  await applyExternalSessionSnapshot('agent-a', 'session-a', {
    ...ports, load: async () => ({ id: 'session-a', agentId: 'agent-a',
      messages: [...original, appended] }) as ChatSession,
  });
  assert.deepEqual(applied.at(-1)?.map(message => message.id), ['old', 'external']);
});

test('an external change during a local run is refreshed once after that run leaves', () => {
  const buffer = new SessionRefreshBuffer();
  assert.equal(buffer.note('session-a', true), false);
  assert.equal(buffer.drain('session-a', true), false);
  assert.equal(buffer.drain('session-b', false), false);
  assert.equal(buffer.drain('session-a', false), true);
  assert.equal(buffer.drain('session-a', false), false);
  assert.equal(buffer.note('session-a', false), true);
});
