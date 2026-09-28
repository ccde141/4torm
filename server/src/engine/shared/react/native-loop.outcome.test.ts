import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoopNative, type LLMCaller } from './native-loop.js';
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
