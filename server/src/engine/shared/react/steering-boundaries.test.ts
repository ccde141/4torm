import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { runReActLoopNative, SuspendSignal } from './native-loop.js';
import { runReActLoop } from './text-loop.js';
import type { ReActSteering } from './steering.js';

const answer = { content: 'done', finishReason: 'stop' as const };
const toolDefs = [{ name: 'read', description: 'read', parameters: { type: 'object' } }];
const nativeCall = { content: '', finishReason: 'tool_calls' as const,
  toolCalls: [{ id: 'call-1', name: 'read', arguments: '{}' }] };
const textCall = { ...answer, content: '{"type":"tool_call","name":"read","arguments":{}}' };

function input() {
  const pending: string[] = [];
  let drains = 0;
  const steering: ReActSteering = {
    hasPending: () => pending.length > 0,
    drain: () => { drains++; return pending.splice(0); },
  };
  return { pending, steering, drainCount: () => drains };
}

for (const native of [true, false]) {
  const loop = native ? runReActLoopNative : runReActLoop;
  test(`${native ? 'native' : 'text'} consumes each input once at model boundaries`, async () => {
    const box = input();
    box.pending.push('Initial correction');
    const snapshots: string[][] = [];
    const result = await loop({
      messages: [{ role: 'system', content: 'rules' }], steering: box.steering, toolDefs,
      llm: { call: async messages => {
        snapshots.push(messages.filter(message => message.role === 'user').map(message => message.content));
        return snapshots.length === 1 ? (native ? nativeCall : textCall) : answer;
      } },
      tools: { call: async () => { box.pending.push('After read'); return 'read finished'; } },
    });
    assert.equal(result.termination.status, 'succeeded');
    assert.deepEqual(snapshots[0], ['Initial correction']);
    assert.equal(snapshots[1].filter(content => content === 'Initial correction').length, 1);
    assert.equal(snapshots[1].at(-1), 'After read');
    assert.equal(box.drainCount(), 2);
  });

  test(`${native ? 'native' : 'text'} model failure leaves newly arrived input pending without retry`, async () => {
    const box = input();
    let calls = 0;
    const result = await loop({
      messages: [], steering: box.steering, toolDefs,
      llm: { call: async () => {
        calls++;
        box.pending.push('Arrived during failure');
        throw new Error('provider unavailable');
      } },
    });
    assert.equal(result.termination.status, 'failed');
    assert.equal(calls, 1);
    assert.equal(box.drainCount(), 0);
    assert.deepEqual(box.pending, ['Arrived during failure']);
  });

  test(`${native ? 'native' : 'text'} pre-existing stop does not consume input or call the model`, async () => {
    const box = input();
    box.pending.push('Not consumed');
    const messages: ContextMessage[] = [];
    let calls = 0;
    const result = await loop({
      messages, steering: box.steering, toolDefs, signal: AbortSignal.abort(),
      llm: { call: async () => { calls++; return answer; } },
    });
    assert.equal(result.termination.status, 'aborted');
    assert.equal(calls, 0);
    assert.equal(box.drainCount(), 0);
    assert.deepEqual(messages, []);
  });

  test(`${native ? 'native' : 'text'} steering cannot bypass the hard turn limit`, async () => {
    const box = input();
    let calls = 0;
    const result = await loop({
      messages: [], steering: box.steering, toolDefs, maxTurns: 2,
      llm: { call: async () => {
        calls++;
        box.pending.push(`new input ${calls}`);
        return answer;
      } },
    });
    assert.equal(result.termination.status, 'anomaly');
    assert.equal(calls, 2);
    assert.deepEqual(box.pending, ['new input 2']);
  });
}

test('native ask keeps pending human input separate from its required confirmation', async () => {
  const box = input();
  const messages: ContextMessage[] = [];
  const result = await runReActLoopNative({
    messages, steering: box.steering, toolDefs,
    llm: { call: async () => nativeCall },
    tools: { call: async () => { box.pending.push('An unrelated request'); throw new SuspendSignal('Approve?'); } },
    onToolError: error => error instanceof SuspendSignal ? { reason: 'ask', question: error.question } : null,
  });
  assert.equal(result.termination.status, 'waiting');
  assert.equal(result.suspended?.pendingToolCallId, 'call-1');
  assert.deepEqual(box.pending, ['An unrelated request']);
  assert.equal(box.drainCount(), 0);
});

test('native steering does not resume the old truncated-tool plan', async () => {
  const box = input();
  let calls = 0;
  const messages: ContextMessage[] = [];
  const result = await runReActLoopNative({
    messages, steering: box.steering, toolDefs,
    llm: { call: async () => {
      if (++calls === 1) {
        box.pending.push('New plan');
        return { ...nativeCall, finishReason: 'length',
          toolCalls: [{ id: 'partial', name: 'read', arguments: '{"path":' }] };
      }
      return answer;
    } },
  });
  assert.equal(result.termination.status, 'succeeded');
  assert.deepEqual(messages.map(message => message.role), ['assistant', 'tool', 'user', 'assistant']);
  assert.equal(messages[1].toolCallId, 'partial');
  assert.equal(messages[2].content, 'New plan');
});
