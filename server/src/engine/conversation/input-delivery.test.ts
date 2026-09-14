import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationInputInbox } from './input-inbox.js';
import { runReActLoopNative } from '../shared/react/native-loop.js';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}

test('delayed disk write finishing after the final model output is retained, not silently discarded', async () => {
  const disk = gate();
  const inbox = new ConversationInputInbox('run', async () => disk.wait);
  let acceptance: Promise<unknown> | undefined;
  let modelCalls = 0;
  const result = await runReActLoopNative({
    messages: [], toolDefs: [],
    steering: { hasPending: () => inbox.hasPending(), drain: () => inbox.drain().map(item => item.content) },
    llm: { call: async () => {
      modelCalls++;
      acceptance = inbox.submit({ id: 'late', content: 'one more thing' });
      return { content: 'finished', finishReason: 'stop' };
    } },
  });
  const closing = inbox.close();
  disk.release();
  await acceptance;
  const retained = await closing;
  assert.equal(result.termination.status, 'succeeded');
  assert.equal(modelCalls, 1);
  assert.deepEqual(retained.map(item => item.id), ['late']);
  assert.deepEqual(inbox.drain(), []);
});

test('persisted input during a running tool changes the next model request without a second writer', async () => {
  const inbox = new ConversationInputInbox('run', async () => {});
  const executed: string[] = [];
  let modelCalls = 0;
  const result = await runReActLoopNative({
    messages: [],
    toolDefs: ['read', 'write'].map(name => ({ name, description: name, parameters: { type: 'object' } })),
    steering: { hasPending: () => inbox.hasPending(), drain: () => inbox.drain().map(item => item.content) },
    tools: { call: async name => {
      executed.push(name);
      await inbox.submit({ id: 'redirect', content: 'read only' });
      return 'read complete';
    } },
    llm: { call: async messages => {
      if (++modelCalls === 1) return {
        content: '', finishReason: 'tool_calls',
        toolCalls: ['read', 'write'].map(name => ({ id: name, name, arguments: '{}' })),
      };
      assert.equal(messages.at(-1)?.role, 'user');
      assert.equal(messages.at(-1)?.content, 'read only');
      return { content: 'read-only result', finishReason: 'stop' };
    } },
  });
  assert.equal(result.termination.status, 'succeeded');
  assert.deepEqual(executed, ['read']);
  assert.deepEqual(await inbox.close(), []);
});
