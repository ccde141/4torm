import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_CONTINUATIONS, runReActLoopNative, type LLMCaller } from './native-loop.js';
import type { ContextMessage } from '../types.js';
import { frameworkError } from '../framework-error.js';

test('native loop exposes a successful terminal state', async () => {
  const result = await runReActLoopNative({
    messages: [{ role: 'user', content: 'Hello' }],
    llm: { call: async () => ({ content: 'Hello back.', finishReason: 'stop' }) },
    toolDefs: [],
  });

  assert.deepEqual(result.termination, { status: 'succeeded' });
});

test('native loop reports an untyped provider failure without exposing its body', async () => {
  const llm: LLMCaller = {
    call: async () => { throw new Error('secret upstream body'); },
  };
  const result = await runReActLoopNative({
    messages: [{ role: 'user', content: 'Hello' }], llm, toolDefs: [],
  });

  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') {
    assert.equal(result.termination.error.code, 'MODEL_REQUEST_FAILED');
    assert.equal(result.termination.error.message, '模型请求失败');
  }
  assert.doesNotMatch(result.content, /secret upstream body/);
});

test('native loop preserves a safe typed provider failure for the UI', async () => {
  const llm: LLMCaller = { call: async () => { throw frameworkError({
    code: 'MODEL_AUTH_FAILED', kind: 'permission', message: '模型服务鉴权失败（HTTP 401），请检查 API Key',
    source: 'llm-bridge', retryable: false,
  }); } };
  const result = await runReActLoopNative({
    messages: [{ role: 'user', content: 'Hello' }], llm, toolDefs: [],
  });
  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') {
    assert.equal(result.termination.error.code, 'MODEL_AUTH_FAILED');
    assert.match(result.content, /鉴权失败/);
  }
});

test('native loop reports repeated empty model output as failure', async () => {
  let requests = 0;
  const result = await runReActLoopNative({
    messages: [{ role: 'user', content: 'Hello' }],
    llm: { call: async () => {
      requests++;
      return { content: '', finishReason: 'stop' };
    } },
    toolDefs: [],
    maxTurns: 12,
  });

  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') {
    assert.equal(result.termination.error.code, 'MODEL_EMPTY_RESPONSE');
  }
  assert.equal(requests, 1);
});

test('native limited tool calls never execute after the continuation allowance, even with valid JSON', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'write once' }];
  let requests = 0; let executions = 0;
  const result = await runReActLoopNative({ messages,
    llm: { call: async () => {
      requests++;
      return { content: requests === 1 ? '原件已准备' : `本轮正文-${requests}`,
        finishReason: requests === 1 ? 'tool_calls' : 'length',
        toolCalls: [{ id: `write-${requests}`, name: 'write', arguments: '{"text":"valid JSON"}' }] };
    } },
    tools: { call: async () => { executions++; return '已保存原件'; } },
    toolDefs: [{ name: 'write', description: 'write', parameters: { type: 'object' } }],
  });
  assert.equal(requests, MAX_CONTINUATIONS + 2);
  assert.equal(executions, 1);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].result, '已保存原件');
  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') assert.equal(result.termination.error.code, 'MODEL_OUTPUT_LIMIT');
  assert.match(result.content, /原件已准备/);
  assert.match(result.content, /本轮正文-7/);
  assert.equal(messages.filter(message => message.toolCalls?.length).length, 1);
  assert.equal(messages.filter(message => message.role === 'tool').length, 1);
});

test('native retains every readable body fragment when continued output still reaches its limit', async () => {
  let requests = 0;
  const result = await runReActLoopNative({ messages: [{ role: 'user', content: 'long answer' }],
    llm: { call: async () => ({ content: `正文-${++requests}`, finishReason: 'length' }) }, toolDefs: [],
  });
  assert.equal(requests, MAX_CONTINUATIONS + 1);
  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') assert.equal(result.termination.error.code, 'MODEL_OUTPUT_LIMIT');
  for (let index = 1; index <= requests; index++) assert.match(result.content, new RegExp(`正文-${index}`));
  assert.equal(result.rawContent, result.content);
});

test('native reasoning-only length response reports the real output limit without another request', async () => {
  let requests = 0;
  const messages: ContextMessage[] = [{ role: 'user', content: 'answer' }];
  const result = await runReActLoopNative({ messages,
    llm: { call: async () => {
      requests++;
      return { content: '', reasoningContent: 'unfinished reasoning', finishReason: 'length',
        reasoningEnvelope: { field: 'reasoning_details', value: [{ signature: 'preserve' }] } };
    } }, toolDefs: [],
  });
  assert.equal(requests, 1);
  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') assert.equal(result.termination.error.code, 'MODEL_OUTPUT_LIMIT');
  assert.equal(result.rawContent, '');
  assert.doesNotMatch(result.content, /unfinished reasoning/);
  assert.equal(messages.at(-1)?.reasoningContent, 'unfinished reasoning');
  assert.deepEqual(messages.at(-1)?.reasoningEnvelope?.value, [{ signature: 'preserve' }]);
});

for (const abort of [false, true]) {
  test(`native retains earlier body when continuation fails (aborted: ${abort})`, async () => {
    const controller = new AbortController();
    let requests = 0;
    const result = await runReActLoopNative({ messages: [{ role: 'user', content: 'long answer' }],
      signal: controller.signal, toolDefs: [], onEvent: () => {},
      llm: { call: async (_messages, _options, onChunk) => {
        if (++requests <= 2) return { content: `正文-${requests}`, finishReason: 'length' };
        onChunk?.('本次已生成部分');
        if (abort) controller.abort();
        throw new Error('secret upstream interruption');
      } },
    });
    assert.equal(requests, 3);
    assert.equal(result.termination.status, abort ? 'aborted' : 'failed');
    assert.equal(result.content, '正文-1\n\n正文-2\n\n本次已生成部分');
    assert.equal(result.rawContent, result.content);
    assert.doesNotMatch(result.content, /secret upstream/);
  });
}
