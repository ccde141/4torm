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

for (const retainBeforeFinish of [false, true]) for (const retainFinalContext of [false, true]) {
  test(`text completion stores one reply per request across handoffs (${retainBeforeFinish}, ${retainFinalContext})`, async () => {
    const messages: ContextMessage[] = [{ role: 'user', content: 'work' }];
    let calls = 0;
    const result = await runReActLoop({ messages, retainBeforeFinish, retainFinalContext,
      llm: { call: async () => ({ content: `REPLY-${++calls}`, finishReason: 'stop' }) },
      beforeFinish: async () => {
        assert.equal(messages.filter(message => message.role === 'assistant' && message.content === `REPLY-${calls}`).length, 1,
          'the completion hook sees one canonical copy of this response');
        return calls === 1 ? ['[framework] late member update'] : [];
      },
    });
    assert.equal(result.termination.status, 'succeeded');
    assert.equal(result.content, 'REPLY-2');
    assert.deepEqual(messages.filter(message => message.role === 'assistant').map(message => message.content),
      ['REPLY-1', 'REPLY-2']);
  });
}
