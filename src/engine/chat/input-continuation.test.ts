import assert from 'node:assert/strict';
import test from 'node:test';
import { continueInputTurn } from './input-continuation';
import type { ChatSession } from '../../store/chat';

const input = { agentId: 'agent', sessionId: 'session', runId: 'old', id: 'human', content: 'new direction' };
const session = { id: 'session', agentId: 'agent', messages: [
  { id: 'old', role: 'assistant', content: 'final result', timestamp: 'now', inputRunId: 'old',
    humanInputs: [{ ...input, sequence: 1, receivedAt: 'now', state: 'retained' }] },
] } as ChatSession;

test('handoff preserves the final response and saves one ordinary user message before launching', async () => {
  let current = structuredClone(session);
  let launches = 0;
  const ports = { load: async () => current, canStart: () => true,
    save: async (value: ChatSession) => { current = value; },
    start: (value: ChatSession, runId: string) => {
      assert.equal(current.messages.at(-1)?.id, input.id);
      assert.equal(value.messages[0].content, 'final result');
      assert.equal(value.messages[0].humanInputs?.length, 0);
      launches++;
      current = { ...current, messages: [...current.messages,
        { id: runId, role: 'assistant', inputRunId: runId, content: '', timestamp: 'now' }] };
    } };
  await continueInputTurn(input, ports);
  await continueInputTurn(input, ports);
  assert.equal(launches, 1);
  assert.equal(current.messages.filter(message => message.id === input.id).length, 1);
});

test('deleted sessions, changed ownership and a new active run cannot be overwritten', async () => {
  for (const value of [null, { ...session, agentId: 'other' }, session]) {
    let writes = 0;
    await assert.rejects(continueInputTurn(input, { load: async () => value,
      canStart: () => false, save: async () => { writes++; }, start: () => { writes++; } }));
    assert.equal(writes, 0);
  }
});

test('failure to save the ordinary message prevents model execution', async () => {
  let starts = 0;
  await assert.rejects(continueInputTurn(input, { load: async () => session, canStart: () => true,
    save: async () => { throw new Error('disk full'); }, start: () => { starts++; } }), /disk full/);
  assert.equal(starts, 0);
});
