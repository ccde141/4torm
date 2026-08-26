import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverProviderRuntimeCapabilities,
  normalizeChatRequestBody,
  resolveMaxOutputTokens,
  resolveRequestTemperature,
  resolveSafePromptTokens,
  resolveProviderModelCapabilities,
} from './request-normalization.js';
const baseBody = {
  model: 'model', messages: [], temperature: 0.7,
  max_tokens: 8192, stream: true, tool_choice: 'auto',
};

test('Kimi K3 omits fixed temperature and uses max_completion_tokens', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
    { ...baseBody, model: 'kimi-k3' },
  );
  assert.equal('temperature' in body, false);
  assert.equal('max_tokens' in body, false);
  assert.equal(body.max_completion_tokens, 8192);
});

test('Kimi K2.7 Code uses the same fixed-parameter policy', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'https://api.kimi.com/v1', model: 'kimi-k2.7-code' },
    { ...baseBody, model: 'kimi-k2.7-code' },
  );
  assert.equal('temperature' in body, false);
  assert.equal(body.max_completion_tokens, 8192);
  assert.equal(body.tool_choice, 'auto');
});

test('generic OpenAI-compatible providers keep existing request fields', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'https://example.test/v1', model: 'custom-model' },
    { ...baseBody, model: 'custom-model' },
  );
  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 8192);
  assert.equal('max_completion_tokens' in body, false);
});

test('custom parameters apply after provider normalization without exposing core fields', () => {
  const body = normalizeChatRequestBody({
    baseUrl: 'https://example.test/v1', model: 'custom-model',
    customRequestParameters: {
      max_tokens: 4096,
      chat_template_kwargs: { custom_mode: 'fast' },
    },
  }, { ...baseBody, model: 'custom-model' });
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.chat_template_kwargs, { custom_mode: 'fast' });
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://example.test/v1', model: 'custom-model',
    customRequestParameters: { messages: [] },
  }, { ...baseBody }), /不能覆盖核心字段.*messages/);
});

test('llama.cpp auto thinking inherits the server template without changing standard fields', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen3.5-9b-q6', profile: 'llama-cpp' },
    { ...baseBody, model: 'qwen3.5-9b-q6' },
  );

  assert.equal('chat_template_kwargs' in body, false);
  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 8192);
});

test('explicit provider type selects its adapter without endpoint inference', () => {
  assert.equal(resolveProviderModelCapabilities({
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    providerType: 'openai-compatible',
  }).temperature, 'passthrough');
  const body = normalizeChatRequestBody({
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'qwen',
    providerType: 'llama-cpp',
  }, { ...baseBody, model: 'qwen' });
  assert.equal('chat_template_kwargs' in body, false);
});

test('llama.cpp consumes explicit thinking mode and token budget', () => {
  const baseIdentity = {
    baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen', providerType: 'llama-cpp' as const,
    generationDefaults: { maxOutputTokens: 2048, thinkingBudgetTokens: 4096 },
  };
  const enabled = normalizeChatRequestBody({
    ...baseIdentity, generationDefaults: { ...baseIdentity.generationDefaults, thinkingMode: 'enabled' },
  }, { model: 'qwen', messages: [], chat_template_kwargs: { custom: true } });
  assert.deepEqual(enabled.chat_template_kwargs, { custom: true, enable_thinking: true });
  assert.equal(enabled.thinking_budget_tokens, 4096);

  const disabled = normalizeChatRequestBody({
    ...baseIdentity, generationDefaults: { ...baseIdentity.generationDefaults, thinkingMode: 'disabled' },
  }, { model: 'qwen', messages: [] });
  assert.deepEqual(disabled.chat_template_kwargs, { enable_thinking: false });
  assert.equal(disabled.thinking_budget_tokens, 4096);
});

test('provider capability supplies a default output budget while explicit calls remain authoritative', () => {
  const llama = { baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen3.5-9b-q6', profile: 'llama-cpp' };
  const generic = { baseUrl: 'https://example.test/v1', model: 'cloud-model' };

  assert.equal(resolveMaxOutputTokens(llama), 2048);
  assert.equal(resolveMaxOutputTokens(llama, 4096), 4096);
  assert.equal(resolveMaxOutputTokens(generic), 8192);
});

test('llama.cpp consumes configured output and sampling defaults', () => {
  const identity = {
    baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen', providerType: 'llama-cpp' as const,
    generationDefaults: {
      maxOutputTokens: 3072, temperature: 0.6, topK: 20,
      topP: 0.9, minP: 0.1, repeatPenalty: 1.05,
    },
  };
  assert.equal(resolveMaxOutputTokens(identity), 3072);
  assert.equal(resolveMaxOutputTokens(identity, 4096), 4096);
  assert.equal(resolveRequestTemperature(identity), 0.6);
  assert.equal(resolveRequestTemperature(identity, 0.2), 0.2);
  const body = normalizeChatRequestBody(identity, { model: 'qwen', messages: [] });
  assert.equal(body.top_k, 20);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.min_p, 0.1);
  assert.equal(body.repeat_penalty, 1.05);
});

test('llama.cpp null sampling values inherit the server while generic providers keep framework defaults', () => {
  const llama = {
    baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen', providerType: 'llama-cpp' as const,
    generationDefaults: { maxOutputTokens: 2048, temperature: null, topK: null },
  };
  assert.equal(resolveRequestTemperature(llama), undefined);
  assert.equal(resolveRequestTemperature({ baseUrl: 'https://example.test/v1', model: 'cloud' }), 0.7);
  const body = normalizeChatRequestBody(llama, { model: 'qwen', messages: [] });
  assert.equal('top_k' in body, false);
  assert.equal('temperature' in body, false);
});

test('safe prompt budget reserves output and runtime headroom', () => {
  assert.equal(resolveSafePromptTokens(8_192, 2_048), 5_734);
  assert.equal(resolveSafePromptTokens(16_384, 2_048), 13_516);
  assert.throws(() => resolveSafePromptTokens(2_048, 2_048), /输出预算/);
});

test('llama.cpp profile discovers the running slot context and modalities from props', async () => {
  let requestedUrl = '';
  const runtime = await discoverProviderRuntimeCapabilities(
    { baseUrl: 'http://127.0.0.1:8080/v1', model: 'local', profile: 'llama-cpp' },
    async input => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        default_generation_settings: { n_ctx: 16_384 },
        total_slots: 2,
        modalities: { vision: false, audio: false, video: false },
      }), { status: 200 });
    },
  );

  assert.equal(requestedUrl, 'http://127.0.0.1:8080/props');
  assert.deepEqual(runtime, {
    contextWindowTokens: 16_384,
    parallelSlots: 2,
    modalities: { vision: false, audio: false, video: false },
  });
});

test('llama.cpp configured runtime limits only tighten observed props', async () => {
  const runtime = await discoverProviderRuntimeCapabilities(
    {
      baseUrl: 'http://127.0.0.1:8080/v1', model: 'local', providerType: 'llama-cpp',
      runtimePolicy: { contextWindowTokens: 12_000, maxConcurrency: 1 },
    },
    async () => new Response(JSON.stringify({
      default_generation_settings: { n_ctx: 16_384 }, total_slots: 2,
    })),
  );
  assert.deepEqual(runtime, { contextWindowTokens: 12_000, parallelSlots: 1 });
});

test('generic OpenAI-compatible providers do not receive llama.cpp private probes', async () => {
  let calls = 0;
  const runtime = await discoverProviderRuntimeCapabilities(
    { baseUrl: 'https://example.test/v1', model: 'cloud' },
    async () => { calls++; return new Response('{}'); },
  );
  assert.equal(calls, 0);
  assert.equal(runtime, undefined);
});

test('llama.cpp runtime discovery rejects an invalid context size', async () => {
  await assert.rejects(
    discoverProviderRuntimeCapabilities(
      { baseUrl: 'http://127.0.0.1:8080/v1', model: 'local', profile: 'llama-cpp' },
      async () => new Response(JSON.stringify({ default_generation_settings: { n_ctx: 0 } })),
    ),
    /有效上下文容量/,
  );
});

test('LM Studio profile omits empty assistant placeholders but keeps tool calls', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'http://localhost:1234/v1', model: 'local-model', profile: 'lmstudio' },
    {
      ...baseBody,
      messages: [
        { role: 'user', content: 'continue' },
        { role: 'assistant', content: '' },
        {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
        },
      ],
    },
  );

  assert.deepEqual(body.messages, [
    { role: 'user', content: 'continue' },
    {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
    },
  ]);
});

test('explicit LM Studio identity applies its message compatibility adapter', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'http://localhost:1234/v1', model: 'local-model', providerType: 'lm-studio' },
    { ...baseBody, messages: [{ role: 'assistant', content: '' }, { role: 'user', content: 'continue' }] },
  );
  assert.deepEqual(body.messages, [{ role: 'user', content: 'continue' }]);
});

test('LM Studio inherits inference presets unless the user explicitly overrides fields', () => {
  const identity = {
    baseUrl: 'http://localhost:1234/v1', model: 'qwen3.5-9b', providerType: 'lm-studio' as const,
  };
  const inherited = normalizeChatRequestBody(identity, { ...baseBody });
  assert.equal('temperature' in inherited, false);
  assert.equal('max_tokens' in inherited, false);
  assert.equal('max_completion_tokens' in inherited, false);

  const overridden = normalizeChatRequestBody({
    ...identity,
    customRequestParameters: { temperature: 0.2, max_tokens: 512, top_p: 0.9 },
  }, { ...baseBody });
  assert.equal(overridden.temperature, 0.2);
  assert.equal(overridden.max_tokens, 512);
  assert.equal(overridden.top_p, 0.9);
});

test('LM Studio reads the active instance budget without changing its load preset', async () => {
  let requestedUrl = '';
  const runtime = await discoverProviderRuntimeCapabilities(
    { baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen3.5-9b', providerType: 'lm-studio' },
    async (input, init) => {
      requestedUrl = String(input);
      assert.equal(init, undefined);
      return new Response(JSON.stringify({ models: [{
        type: 'llm', key: 'qwen3.5-9b', max_context_length: 262_144,
        loaded_instances: [{ id: 'qwen3.5-9b', config: { context_length: 58_624, parallel: 4 } }],
        capabilities: { vision: true },
      }] }));
    },
  );
  assert.equal(requestedUrl, 'http://127.0.0.1:1234/api/v1/models');
  assert.deepEqual(runtime, {
    contextWindowTokens: 58_624,
    parallelSlots: 4,
    modalities: { vision: true, audio: false, video: false },
  });
});

test('LM Studio leaves the framework budget unknown when the model is not loaded', async () => {
  const runtime = await discoverProviderRuntimeCapabilities(
    { baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen3.8-27b-obliterated', providerType: 'lm-studio' },
    async () => new Response(JSON.stringify({ models: [{
      type: 'llm', key: 'qwen3.8-27b-obliterated', max_context_length: 262_144,
      loaded_instances: [], capabilities: { vision: false },
    }] })),
  );
  assert.equal(runtime, undefined);
});

test('LM Studio profile text-encodes tool history with array arguments', () => {
  const messages = [
    { role: 'user', content: 'update the board' },
    {
      role: 'assistant', content: null,
      tool_calls: [
        {
          id: 'call-board', type: 'function',
          function: {
            name: 'task_board',
            arguments: JSON.stringify({ action: 'set', tasks: [{ title: 'test' }] }),
          },
        },
        {
          id: 'call-file', type: 'function',
          function: { name: 'delete_file', arguments: JSON.stringify({ path: 'old.txt' }) },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call-board', content: 'board updated' },
    { role: 'tool', tool_call_id: 'call-file', content: 'file deleted' },
    { role: 'user', content: 'continue' },
  ];
  const body = normalizeChatRequestBody(
    { baseUrl: 'http://localhost:1234/v1', model: 'local-model', profile: 'lmstudio' },
    { ...baseBody, messages, tools: [{ type: 'function' }] },
  );

  assert.deepEqual(body.messages, [
    messages[0],
    {
      role: 'assistant',
      content: [
        JSON.stringify({
          type: 'tool_call', name: 'task_board',
          arguments: { action: 'set', tasks: [{ title: 'test' }] },
        }),
        JSON.stringify({
          type: 'tool_call', name: 'delete_file', arguments: { path: 'old.txt' },
        }),
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        type: 'tool_result', name: 'task_board', ok: true, content: 'board updated',
      }),
    },
    {
      role: 'user',
      content: JSON.stringify({
        type: 'tool_result', name: 'delete_file', ok: true, content: 'file deleted',
      }),
    },
    messages[4],
  ]);
  assert.deepEqual(body.tools, [{ type: 'function' }]);
  assert.equal(body.tool_choice, 'auto');
});

test('generic providers keep array-valued native tool history unchanged', () => {
  const messages = [{
    role: 'assistant', content: null,
    tool_calls: [{
      id: 'call-1', type: 'function',
      function: { name: 'task_board', arguments: JSON.stringify({ tasks: [] }) },
    }],
  }];
  const body = normalizeChatRequestBody(
    { baseUrl: 'https://example.test/v1', model: 'custom-model' },
    { ...baseBody, messages },
  );

  assert.deepEqual(body.messages, messages);
});

test('reasoning history is forwarded only by providers with preserved thinking', () => {
  assert.equal(resolveProviderModelCapabilities({
    baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.7-code',
  }).reasoningHistory, 'reasoning_content');
  assert.equal(resolveProviderModelCapabilities({
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner',
  }).reasoningHistory, 'reasoning_content');
  assert.equal(resolveProviderModelCapabilities({
    baseUrl: 'https://example.test/v1', model: 'custom-model',
  }).reasoningHistory, 'omit');
});

