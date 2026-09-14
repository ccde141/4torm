import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { runReActLoopNative } from './native-loop.js';
import { runReActLoop } from './text-loop.js';

function inbox() {
  const pending: string[] = [];
  return {
    pending,
    hasPending: () => pending.length > 0,
    drain: () => pending.splice(0),
  };
}

const toolDefs = ['read', 'write'].map(name => ({
  name, description: name, parameters: { type: 'object' },
}));
const batch = {
  content: 'Original plan', finishReason: 'tool_calls' as const,
  reasoningContent: 'original reasoning',
  toolCalls: ['read', 'write'].map(name => ({ id: name, name, arguments: '{}' })),
};
const final = { content: 'Revised plan', finishReason: 'stop' as const };

test('native steering lets the running tool finish, skips remaining calls and pairs before user input', async () => {
  const steering = inbox();
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' }];
  const executed: string[] = [];
  const skipped: string[] = [];
  let modelCalls = 0;
  const result = await runReActLoopNative({
    messages, steering: { ...steering, onSkipped: tool => skipped.push(tool) }, toolDefs,
    llm: { call: async () => {
      if (++modelCalls === 1) return batch;
      assert.deepEqual(messages.map(message => message.role), ['system', 'assistant', 'tool', 'tool', 'user', 'user']);
      assert.equal(messages[1].reasoningContent, 'original reasoning');
      assert.equal(messages[2].content, 'read finished');
      assert.equal(messages[3].toolCallId, 'write');
      assert.deepEqual(messages.slice(-2).map(message => message.content), ['Do not write', 'Explain first']);
      return final;
    } },
    tools: { call: async name => {
      executed.push(name);
      steering.pending.push('Do not write', 'Explain first');
      return 'read finished';
    } },
  });
  assert.deepEqual(executed, ['read']);
  assert.equal(result.termination.status, 'succeeded');
  assert.equal(result.toolCalls[1].meta && (result.toolCalls[1].meta as { skipped: boolean }).skipped, true);
  assert.deepEqual(skipped, ['write']);
  assert.deepEqual(steering.pending, []);
});

test('native input received during model output skips the entire not-yet-started batch', async () => {
  const steering = inbox();
  let calls = 0;
  const messages: ContextMessage[] = [];
  const executed: string[] = [];
  const result = await runReActLoopNative({
    messages, steering, toolDefs,
    llm: { call: async () => {
      if (++calls === 1) { steering.pending.push('Change direction'); return batch; }
      assert.deepEqual(messages.map(message => message.role), ['assistant', 'tool', 'tool', 'user']);
      return final;
    } },
    tools: { call: async name => { executed.push(name); return 'unexpected'; } },
  });
  assert.equal(calls, 2);
  assert.deepEqual(executed, []);
  assert.equal(result.termination.status, 'succeeded');
});

for (const native of [true, false]) {
  test(`${native ? 'native' : 'text'} late input at final output is consumed before closing the loop`, async () => {
    const steering = inbox();
    const messages: ContextMessage[] = [];
    let calls = 0;
    const params = {
      messages, steering, toolDefs,
      llm: { call: async () => {
        if (++calls === 1) { steering.pending.push('One more requirement'); return final; }
        assert.equal(messages.at(-1)?.content, 'One more requirement');
        assert.equal(messages.at(-1)?.role, 'user');
        return { ...final, content: 'Requirement addressed' };
      } },
    };
    const result = await (native ? runReActLoopNative(params) : runReActLoop(params));
    assert.equal(calls, 2);
    assert.match(result.content, /Requirement addressed/);
  });

  test(`${native ? 'native' : 'text'} stop wins over pending input after a tool`, async () => {
    const steering = inbox();
    const controller = new AbortController();
    let calls = 0;
    const params = {
      messages: [] as ContextMessage[], steering, toolDefs, signal: controller.signal,
      llm: { call: async () => {
        calls++;
        return native ? batch : { ...final, content: '{"type":"tool_call","name":"read","arguments":{}}' };
      } },
      tools: { call: async () => {
        steering.pending.push('Must remain pending');
        controller.abort();
        return 'finished';
      } },
    };
    const result = await (native ? runReActLoopNative(params) : runReActLoop(params));
    assert.equal(result.termination.status, 'aborted');
    assert.equal(calls, 1);
    assert.deepEqual(steering.pending, ['Must remain pending']);
  });
}

test('text steering skips a proposed tool without claiming a successful result', async () => {
  const steering = inbox();
  const messages: ContextMessage[] = [];
  let calls = 0;
  const result = await runReActLoop({
    messages, steering,
    llm: { call: async () => {
      if (++calls === 1) {
        steering.pending.push('Do not write');
        return { ...final, content: '{"type":"tool_call","name":"write","arguments":{}}' };
      }
      const skipped = JSON.parse(messages[1].content);
      assert.equal(skipped.ok, false);
      assert.equal(skipped.name, 'write');
      assert.equal(messages[2].content, 'Do not write');
      return final;
    } },
    tools: { call: async () => { assert.fail('No tool should execute'); } },
  });
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.termination.status, 'succeeded');
});

test('text steering takes precedence over automatic continuation of a truncated tool envelope', async () => {
  const steering = inbox();
  let calls = 0;
  const result = await runReActLoop({
    messages: [], steering,
    llm: { call: async messages => {
      if (++calls === 1) {
        steering.pending.push('Cancel that plan');
        return { content: '{"type":"tool_call","name":"write","arguments":', finishReason: 'length' };
      }
      assert.equal(messages.at(-1)?.content, 'Cancel that plan');
      return final;
    } },
    tools: { call: async () => { assert.fail('Truncated calls must not execute'); } },
  });
  assert.equal(calls, 2);
  assert.equal(result.termination.status, 'succeeded');
});
