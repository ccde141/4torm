import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeChatRequestBody,
  resolveProviderModelCapabilities,
} from './request-normalization.js';
import { resolveProviderAdapter } from './registry.js';

const baseBody = {
  model: 'model', messages: [], temperature: 0.7,
  max_tokens: 8192, stream: true, tool_choice: 'auto',
};

test('provider adapters resolve by explicit module priority with a generic fallback', () => {
  assert.equal(resolveProviderAdapter({ baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.7-code' }).id, 'kimi');
  assert.equal(resolveProviderAdapter({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' }).id, 'deepseek');
  assert.equal(resolveProviderAdapter({ baseUrl: 'http://localhost:1234/v1', model: 'qwen-local' }).id, 'openai-compatible');
});

test('GLM 5 enables preserved thinking on the official BigModel endpoint', () => {
  const identity = { baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-5.2' };
  const body = normalizeChatRequestBody(identity, { ...baseBody, model: identity.model });
  assert.equal(resolveProviderAdapter(identity).id, 'zhipu-glm');
  assert.deepEqual(body.thinking, { type: 'enabled', clear_thinking: false });
  assert.equal(resolveProviderModelCapabilities(identity).reasoningHistory, 'reasoning_content');
});

test('local and older GLM models keep generic OpenAI-compatible behavior', () => {
  assert.equal(resolveProviderAdapter({ baseUrl: 'http://localhost:1234/v1', model: 'glm-5.2' }).id, 'openai-compatible');
  assert.equal(resolveProviderAdapter({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-4-flash' }).id, 'openai-compatible');
});

test('DeepSeek reasoning models remove incompatible sampling fields', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' },
    { ...baseBody, model: 'deepseek-v4-pro', top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.1 },
  );
  assert.equal('thinking' in body, false);
  for (const field of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) {
    assert.equal(field in body, false);
  }
});

test('DeepSeek chat and third-party hosted models are not forced into thinking mode', () => {
  const chatBody = normalizeChatRequestBody(
    { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { ...baseBody, model: 'deepseek-chat' },
  );
  const hostedBody = normalizeChatRequestBody(
    { baseUrl: 'http://localhost:1234/v1', model: 'deepseek-v4-pro' },
    { ...baseBody, model: 'deepseek-v4-pro' },
  );
  assert.equal('thinking' in chatBody, false);
  assert.equal(chatBody.temperature, 0.7);
  assert.equal('thinking' in hostedBody, false);
  assert.equal(hostedBody.temperature, 0.7);
});

test('DashScope Qwen reasoning models inherit platform thinking defaults', () => {
  for (const baseUrl of ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1']) {
    const identity = { baseUrl, model: 'qwen3-max' };
    const body = normalizeChatRequestBody(identity, { ...baseBody, model: identity.model });
    assert.equal(resolveProviderAdapter(identity).id, 'dashscope');
    assert.equal('enable_thinking' in body, false);
    assert.equal('preserve_thinking' in body, false);
    assert.equal('thinking_budget' in body, false);
    assert.equal(resolveProviderModelCapabilities(identity).reasoningHistory, 'reasoning_content');
  }
});

test('DashScope non-reasoning and locally hosted Qwen models keep generic behavior', () => {
  assert.equal(resolveProviderAdapter({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' }).id, 'openai-compatible');
  assert.equal(resolveProviderAdapter({ baseUrl: 'http://localhost:1234/v1', model: 'qwen3-max' }).id, 'openai-compatible');
});

test('MiniMax official models split reasoning and preserve structured history', () => {
  for (const baseUrl of ['https://api.minimax.io/v1', 'https://api.minimaxi.com/v1']) {
    const identity = { baseUrl, model: 'MiniMax-M2.5' };
    const body = normalizeChatRequestBody(identity, { ...baseBody, model: identity.model });
    assert.equal(resolveProviderAdapter(identity).id, 'minimax');
    assert.equal(body.reasoning_split, true);
    assert.equal(resolveProviderModelCapabilities(identity).reasoningHistory, 'reasoning_details');
  }
});

test('third-party hosted MiniMax models keep generic behavior', () => {
  const identity = { baseUrl: 'http://localhost:1234/v1', model: 'MiniMax-M2.5' };
  const body = normalizeChatRequestBody(identity, { ...baseBody, model: identity.model });
  assert.equal(resolveProviderAdapter(identity).id, 'openai-compatible');
  assert.equal('reasoning_split' in body, false);
});

test('explicit model profile overrides host auto-detection', () => {
  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', profile: 'openai-compatible',
  }).id, 'openai-compatible');
  const identity = {
    baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-235B-A22B', profile: 'siliconflow-thinking',
  };
  const body = normalizeChatRequestBody(identity, { ...baseBody, model: identity.model });
  assert.equal(resolveProviderAdapter(identity).id, 'siliconflow-thinking');
  assert.equal(body.enable_thinking, true);
  assert.equal(resolveProviderModelCapabilities(identity).reasoningHistory, 'reasoning_content');
});

test('unknown or absent profiles fall back to automatic detection', () => {
  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', profile: 'removed-profile',
  }).id, 'kimi');
  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-235B-A22B',
  }).id, 'openai-compatible');
});

test('explicit cloud provider identity wins over endpoint and model heuristics', () => {
  const cases = [
    ['kimi', 'kimi'],
    ['dashscope', 'dashscope'],
    ['zhipu', 'zhipu-glm'],
    ['openrouter', 'openrouter'],
    ['minimax', 'minimax'],
    ['siliconflow', 'siliconflow'],
  ] as const;
  for (const [providerType, adapterId] of cases) {
    assert.equal(resolveProviderAdapter({
      baseUrl: 'http://localhost:9999/v1', model: 'unrelated-model', providerType,
    }).id, adapterId);
  }
});

test('provider-wide identities do not force model-specific thinking fields', () => {
  const cases = [
    { providerType: 'dashscope', model: 'qwen-turbo', forbidden: ['enable_thinking', 'preserve_thinking'] },
    { providerType: 'zhipu', model: 'glm-4-flash', forbidden: ['thinking'] },
    { providerType: 'siliconflow', model: 'vendor/plain-chat', forbidden: ['enable_thinking'] },
  ] as const;
  for (const item of cases) {
    const body = normalizeChatRequestBody(
      { baseUrl: 'http://localhost:9999/v1', model: item.model, providerType: item.providerType },
      { ...baseBody, model: item.model },
    );
    for (const field of item.forbidden) assert.equal(field in body, false);
  }
});

test('explicit provider identity applies only explicit model-specific normalization', () => {
  const dashscope = normalizeChatRequestBody(
    {
      baseUrl: 'http://localhost:9999/v1', model: 'qwen3-max', providerType: 'dashscope',
      generationDefaults: { thinkingMode: 'enabled' },
    },
    { ...baseBody, model: 'qwen3-max' },
  );
  assert.equal(dashscope.enable_thinking, true);
  assert.equal('preserve_thinking' in dashscope, false);

  const zhipu = normalizeChatRequestBody(
    { baseUrl: 'http://localhost:9999/v1', model: 'glm-5.2', providerType: 'zhipu' },
    { ...baseBody, model: 'glm-5.2' },
  );
  assert.deepEqual(zhipu.thinking, { type: 'enabled', clear_thinking: false });
});

test('Zhipu identity applies qualified GLM generation fields by model generation', () => {
  const glm53 = normalizeChatRequestBody({
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', providerType: 'zhipu',
    generationDefaults: {
      maxOutputTokens: 4096, temperature: 0.8, topP: 0.9,
      thinkingMode: 'enabled', reasoningEffort: 'high',
    },
  }, { ...baseBody, model: 'glm-5.3', max_tokens: 4096 });
  assert.deepEqual(glm53.thinking, { type: 'enabled', clear_thinking: false });
  assert.equal(glm53.reasoning_effort, 'high');
  assert.equal(glm53.temperature, 0.8);
  assert.equal(glm53.top_p, 0.9);

  const glm47 = normalizeChatRequestBody({
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7', providerType: 'zhipu',
    generationDefaults: { thinkingMode: 'disabled' },
  }, { ...baseBody, model: 'glm-4.7' });
  assert.deepEqual(glm47.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in glm47, false);
});

test('Zhipu refuses model-specific controls that the selected GLM cannot honor', () => {
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7', providerType: 'zhipu',
    generationDefaults: { reasoningEffort: 'low' },
  }, { ...baseBody, model: 'glm-4.7' }), /reasoningEffort.*仅适用于 GLM-5\.2 和 GLM-5\.3/);
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', providerType: 'zhipu',
    generationDefaults: { thinkingMode: 'enabled' },
  }, { ...baseBody, model: 'glm-4-flash' }), /未验证显式思考模式/);
});
