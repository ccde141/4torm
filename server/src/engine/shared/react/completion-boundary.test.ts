import test from 'node:test';
import assert from 'node:assert/strict';
import { runReActLoopNative } from './native-loop.js';
import { runReActLoop } from './text-loop.js';
import type { ContextMessage } from '../types.js';

for (const native of [true, false]) test(`completion boundary receives late context before final delivery (${native})`, async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'work' }];
  let calls = 0;
  let checks = 0;
  const opts = { messages, toolDefs: [],
    llm: { call: async () => {
      calls++;
      if (calls === 2) assert.equal(messages.at(-1)?.content, '[framework] member result');
      return { content: calls === 1 ? 'premature' : 'verified', finishReason: 'stop' as const };
    } },
    beforeFinish: async () => ++checks === 1 ? ['[framework] member result'] : [],
  };
  const result = native ? await runReActLoopNative(opts) : await runReActLoop(opts);
  assert.equal(result.content, 'verified');
  assert.equal(calls, 2);
  assert.ok(messages.some(message => message.role === 'assistant' && message.content === 'premature'));
});

for (const native of [true, false]) test(`stop during completion handoff cannot deliver success (${native})`, async () => {
  const controller = new AbortController();
  const opts = { messages: [{ role: 'user' as const, content: 'work' }], toolDefs: [], signal: controller.signal,
    llm: { call: async () => ({ content: 'candidate', finishReason: 'stop' as const }) },
    beforeFinish: async () => { controller.abort(); return []; },
  };
  const result = native ? await runReActLoopNative(opts) : await runReActLoop(opts);
  assert.equal(result.termination.status, 'aborted');
});
