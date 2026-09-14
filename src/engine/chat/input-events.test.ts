import assert from 'node:assert/strict';
import test from 'node:test';
import { applyInputEvent, recoverInputMessages, editInputAnswer } from './input-events.js';
import { buildConversationHistory } from './conversation-history.js';
import type { ChatMessage } from '../../types/index.js';

const message: ChatMessage = { id: 'answer', role: 'assistant', content: 'visible answer', timestamp: 'now', inputRunId: 'run' };
const receipt = { id: 'input', content: 'human correction', runId: 'run', sequence: 1, receivedAt: 'now' };
const context = [{ role: 'assistant' as const, content: 'first plan' },
  { role: 'user' as const, content: receipt.content }, { role: 'assistant' as const, content: 'revised' }];

test('receipt and checkpoint converge regardless of HTTP/SSE order, without duplicate history', () => {
  let messages = applyInputEvent([message], 'answer', { type: 'input-context', runId: 'run',
    checkpoint: { context, includedIds: ['input'], closed: false } });
  messages = applyInputEvent(messages, 'answer', { type: 'input-received', receipt });
  messages = applyInputEvent(messages, 'answer', { type: 'input-received', receipt });
  assert.equal(messages[0].humanInputs?.length, 1);
  assert.equal(messages[0].humanInputs?.[0].state, 'included');
  assert.deepEqual(buildConversationHistory(messages), context);
});

test('retained messages are visible but never automatically enter model history', () => {
  let messages = applyInputEvent([message], 'answer', { type: 'input-received', receipt });
  messages = applyInputEvent(messages, 'answer', { type: 'input-closed', runId: 'run', retained: [receipt] });
  assert.equal(messages[0].humanInputs?.[0].state, 'retained');
  assert.equal(buildConversationHistory(messages).some(item => item.content === receipt.content), false);
});

test('foreign run event cannot change the assistant message', () => {
  assert.deepEqual(applyInputEvent([message], 'answer', { type: 'input-received', receipt: { ...receipt, runId: 'other' } }), [message]);
});

test('fresh read recovers persisted inputs and exact context without triggering any POST', async () => {
  let requests = 0;
  const result = await recoverInputMessages([message], 'agent', 'session', async (_input, init) => {
    requests++;
    assert.equal(init?.method ?? 'GET', 'GET');
    return Response.json({ entries: [receipt], checkpoint: { context, includedIds: ['input'], closed: false }, active: false });
  });
  assert.equal(requests, 1);
  assert.equal(result[0].humanInputs?.[0].state, 'included');
  assert.deepEqual(buildConversationHistory(result), context);
});

test('failed recovery is shown and does not destroy locally saved messages', async () => {
  const result = await recoverInputMessages([message], 'agent', 'session', async () => new Response('failed', { status: 500 }));
  assert.equal(result[0].content, message.content);
  assert.ok(result[0].inputRecoveryError);
});

test('inactive execution without human input is closed after recovery instead of polled forever', async () => {
  const result = await recoverInputMessages([message], 'agent', 'session', async () =>
    Response.json({ entries: [], active: false }));
  assert.equal(result[0].inputClosed, true);
});

test('human ask confirmation is preserved when a steering run suspended', () => {
  assert.deepEqual(buildConversationHistory([{ ...message, inputRunId: undefined, content: 'Approve?',
    ask: { question: 'Approve?', answered: true, reply: 'Yes, only files in workspace' } }]), [
    { role: 'assistant', content: 'Approve?' }, { role: 'user', content: 'Yes, only files in workspace' },
  ]);
});

test('editing final text keeps consumed human input and intermediate tool history', () => {
  const edited = editInputAnswer({ ...message, nativeContext: context, contextExact: true }, 'edited final');
  assert.deepEqual(buildConversationHistory([edited]), [...context.slice(0, -1), { role: 'assistant', content: 'edited final' }]);
  assert.equal(edited.inputClosed, true);
});
