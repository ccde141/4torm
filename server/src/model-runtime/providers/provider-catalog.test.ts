import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDER_TYPES } from '../contracts/provider-config.js';
import { providerTransportPolicy } from '../config/provider-policy.js';
import { DEFAULT_LLAMA_CPP_CONFIG } from '../config/llama-cpp-config.js';
import { DEFAULT_OLLAMA_CONFIG } from '../config/ollama-config.js';
import { DEFAULT_DEEPSEEK_CONFIG } from '../config/deepseek-config.js';
import { DEFAULT_VLLM_CONFIG } from '../config/vllm-config.js';
import { DEFAULT_DASHSCOPE_CONFIG } from '../config/dashscope-config.js';
import { DEFAULT_MINIMAX_CONFIG } from '../config/minimax-config.js';
import { getProviderCatalog } from './provider-catalog.js';

test('provider catalog describes every stable provider identity exactly once', () => {
  const catalog = getProviderCatalog();
  const ids = catalog.providers.map(provider => provider.id);
  assert.deepEqual([...ids].sort(), [...PROVIDER_TYPES].sort());
  assert.equal(new Set(ids).size, ids.length);

  for (const provider of catalog.providers) {
    assert.equal(provider.supportedTransports.includes(provider.defaultTransport), true);
    assert.deepEqual({
      defaultTransport: provider.defaultTransport,
      supportedTransports: provider.supportedTransports,
    }, providerTransportPolicy(provider.id));
  }
});

test('provider creation is limited to the generic contract and qualified implementations', () => {
  const catalog = getProviderCatalog();
  const selectable = catalog.providers.filter(provider => provider.selectable);
  assert.deepEqual(selectable.map(provider => provider.id), [
    'openai-compatible',
    'deepseek',
    'kimi',
    'dashscope',
    'zhipu',
    'minimax',
    'llama-cpp',
    'lm-studio',
    'ollama',
    'vllm',
  ]);
  assert.equal(selectable.every(provider => provider.verificationState !== 'unverified'), true);
  assert.deepEqual(catalog.presets.map(preset => preset.id), [
    'openai-compatible',
    'deepseek',
    'kimi',
    'dashscope',
    'zhipu',
    'minimax',
    'lm-studio',
    'llama-cpp',
    'ollama',
    'vllm',
  ]);
  assert.equal(catalog.presets.every(preset => preset.providerType), true);
  assert.deepEqual(catalog.presets.find(preset => preset.id === 'openai-compatible'), {
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    baseUrl: '',
    protocol: 'openai-chat-completions',
    providerType: 'openai-compatible',
    transport: 'openai-chat-completions',
  });
});

test('legacy provider identities remain readable without being offered for creation', () => {
  const catalog = getProviderCatalog();
  for (const id of ['openai-cloud', 'anthropic', 'sglang']) {
    assert.equal(catalog.providers.some(provider => provider.id === id), true);
    assert.equal(catalog.providers.find(provider => provider.id === id)?.selectable, false);
    assert.equal(catalog.presets.some(preset => preset.providerType === id), false);
  }
});

test('unqualified cloud candidates have stable identities but remain unavailable', () => {
  const catalog = getProviderCatalog();
  for (const id of ['openrouter', 'siliconflow'] as const) {
    const provider = catalog.providers.find(item => item.id === id);
    assert.ok(provider);
    assert.equal(provider.selectable, false);
    assert.equal(provider.verificationState, 'unverified');
    assert.equal(provider.probeStrategy, 'openai-models');
    assert.equal(provider.configuration, undefined);
    assert.equal(catalog.presets.some(preset => preset.providerType === id), false);
  }
});

test('MiniMax preset exposes its qualified OpenAI-compatible contract', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'minimax');
  const preset = catalog.presets.find(item => item.id === 'minimax');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.verificationState, 'transport-ready');
  assert.equal(preset.providerType, 'minimax');
  assert.equal(preset.baseUrl, 'https://api.minimaxi.com/v1');
  assert.deepEqual(provider.configuration?.defaults, DEFAULT_MINIMAX_CONFIG);
  assert.deepEqual(provider.configuration?.sections.flatMap(section => section.fields.map(field => field.path)), [
    'generationDefaults.maxOutputTokens',
    'generationDefaults.temperature',
    'generationDefaults.topP',
    'generationDefaults.thinkingMode',
  ]);
});

test('DashScope preset exposes only conservative cross-Qwen controls', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'dashscope');
  const preset = catalog.presets.find(item => item.id === 'dashscope');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.verificationState, 'transport-ready');
  assert.equal(preset.providerType, 'dashscope');
  assert.equal(preset.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.deepEqual(provider.configuration?.defaults, DEFAULT_DASHSCOPE_CONFIG);
  assert.deepEqual(provider.configuration?.sections.flatMap(section => section.fields.map(field => field.path)), [
    'generationDefaults.maxOutputTokens',
    'generationDefaults.temperature',
    'generationDefaults.topP',
    'generationDefaults.thinkingMode',
    'generationDefaults.thinkingBudgetTokens',
  ]);
});

test('Zhipu preset exposes only fields supported by the live GLM matrix', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'zhipu');
  const preset = catalog.presets.find(item => item.id === 'zhipu');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.verificationState, 'transport-ready');
  assert.equal(preset.providerType, 'zhipu');
  assert.equal(preset.baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
  assert.deepEqual(provider.configuration?.sections.flatMap(section => section.fields.map(field => field.path)), [
    'generationDefaults.maxOutputTokens',
    'generationDefaults.temperature',
    'generationDefaults.topP',
    'generationDefaults.thinkingMode',
    'generationDefaults.reasoningEffort',
  ]);
});

test('Kimi preset exposes only the fields that passed live qualification', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'kimi');
  const preset = catalog.presets.find(item => item.id === 'kimi');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.verificationState, 'transport-ready');
  assert.equal(preset.providerType, 'kimi');
  assert.equal(preset.baseUrl, 'https://api.moonshot.cn/v1');
  assert.deepEqual(
    provider.configuration?.sections.flatMap(section => section.fields.map(field => field.path)),
    [
      'generationDefaults.maxOutputTokens',
      'generationDefaults.thinkingMode',
      'generationDefaults.reasoningEffort',
    ],
  );
});

test('vLLM preset exposes request fields and runtime metadata instead of startup arguments', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'vllm');
  const preset = catalog.presets.find(item => item.id === 'vllm');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.probeStrategy, 'vllm-runtime');
  assert.equal(provider.verificationState, 'context-ready');
  assert.equal(preset.providerType, 'vllm');
  assert.deepEqual(provider.configuration?.defaults, DEFAULT_VLLM_CONFIG);
  assert.deepEqual(
    provider.configuration?.sections.flatMap(section => section.fields.map(field => field.path)),
    [
      'generationDefaults.maxOutputTokens',
      'generationDefaults.temperature',
      'generationDefaults.topP',
      'generationDefaults.topK',
      'generationDefaults.minP',
      'generationDefaults.repetitionPenalty',
      'generationDefaults.reasoningEffort',
    ],
  );
});

test('DeepSeek preset persists its qualified identity and stable field schema', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'deepseek');
  const preset = catalog.presets.find(item => item.id === 'deepseek');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.defaultTransport, 'openai-chat-completions');
  assert.equal(provider.probeStrategy, 'openai-models');
  assert.equal(provider.verificationState, 'transport-ready');
  assert.equal(preset.providerType, 'deepseek');
  assert.deepEqual(provider.configuration?.defaults, DEFAULT_DEEPSEEK_CONFIG);
  assert.deepEqual(
    provider.configuration?.sections.flatMap(section => section.fields.map(field => field.path)),
    [
      'generationDefaults.maxOutputTokens',
      'generationDefaults.temperature',
      'generationDefaults.topP',
      'generationDefaults.thinkingMode',
      'generationDefaults.reasoningEffort',
    ],
  );
});

test('Ollama preset uses the implemented chat transport and runtime metadata probe', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'ollama');
  const preset = catalog.presets.find(item => item.id === 'ollama');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.defaultTransport, 'openai-chat-completions');
  assert.deepEqual(provider.supportedTransports, ['openai-chat-completions']);
  assert.equal(provider.probeStrategy, 'ollama-runtime');
  assert.equal(provider.verificationState, 'context-ready');
  assert.equal(preset.providerType, 'ollama');
  assert.equal(preset.transport, 'openai-chat-completions');
  assert.deepEqual(provider.configuration?.defaults, DEFAULT_OLLAMA_CONFIG);
  assert.deepEqual(
    provider.configuration?.sections.flatMap(section => section.fields.map(field => field.path)),
    [
      'generationDefaults.maxOutputTokens',
      'generationDefaults.temperature',
      'generationDefaults.topP',
      'generationDefaults.reasoningEffort',
    ],
  );
});

test('LM Studio preset persists its qualified provider identity', () => {
  const catalog = getProviderCatalog();
  const provider = catalog.providers.find(item => item.id === 'lm-studio');
  const preset = catalog.presets.find(item => item.id === 'lm-studio');
  assert.ok(provider);
  assert.ok(preset);
  assert.equal(provider.selectable, true);
  assert.equal(provider.probeStrategy, 'lm-studio-metadata');
  assert.equal(provider.verificationState, 'context-ready');
  assert.equal(preset.providerType, 'lm-studio');
  assert.equal(preset.transport, 'openai-chat-completions');
});

test('llama.cpp uses the implemented OpenAI transport and private runtime metadata probe', () => {
  const llama = getProviderCatalog().providers.find(provider => provider.id === 'llama-cpp');
  assert.ok(llama);
  assert.equal(llama.defaultTransport, 'openai-chat-completions');
  assert.deepEqual(llama.supportedTransports, ['openai-chat-completions']);
  assert.equal(llama.probeStrategy, 'llama-cpp-metadata');
  assert.equal(llama.verificationState, 'context-ready');
  assert.deepEqual(llama.configuration?.defaults, DEFAULT_LLAMA_CPP_CONFIG);
  assert.deepEqual(
    llama.configuration?.sections.flatMap(section => section.fields.map(field => field.path)),
    [
      'runtimePolicy.contextWindowTokens',
      'runtimePolicy.maxConcurrency',
      'generationDefaults.maxOutputTokens',
      'generationDefaults.temperature',
      'generationDefaults.topK',
      'generationDefaults.topP',
      'generationDefaults.minP',
      'generationDefaults.repeatPenalty',
      'generationDefaults.thinkingMode',
      'generationDefaults.thinkingBudgetTokens',
    ],
  );
});

test('catalog calls return detached data that callers cannot mutate globally', () => {
  const first = getProviderCatalog();
  first.providers[0]!.label = 'mutated';
  first.presets[0]!.label = 'mutated preset';
  first.providers.find(provider => provider.id === 'llama-cpp')!.configuration!.defaults.runtimePolicy.maxConcurrency = 99;
  assert.notEqual(getProviderCatalog().providers[0]!.label, 'mutated');
  assert.notEqual(getProviderCatalog().presets[0]!.label, 'mutated preset');
  assert.equal(getProviderCatalog().providers.find(provider => provider.id === 'llama-cpp')!.configuration!.defaults.runtimePolicy.maxConcurrency, null);
});

test('configuration schema carries validation ranges and localized guidance', () => {
  const llama = getProviderCatalog().providers.find(provider => provider.id === 'llama-cpp')!;
  const maxOutput = llama.configuration!.sections.flatMap(section => section.fields)
    .find(field => field.path === 'generationDefaults.maxOutputTokens')!;
  assert.deepEqual(
    { kind: maxOutput.kind, nullable: maxOutput.nullable, min: maxOutput.min, max: maxOutput.max },
    { kind: 'integer', nullable: false, min: 1, max: 1_000_000 },
  );
  assert.equal(maxOutput.label.zh.length > 0, true);
  assert.equal(maxOutput.label.en.length > 0, true);
  assert.equal(maxOutput.description.zh.length > 0, true);
  assert.deepEqual(llama.configuration!.constraints?.[0], {
    kind: 'less-than',
    valuePath: 'generationDefaults.maxOutputTokens',
    limitPath: 'runtimePolicy.contextWindowTokens',
    message: {
      zh: '最大输出 Tokens 必须小于上下文容量上限。',
      en: 'Maximum output tokens must be lower than the context window cap.',
    },
  });
});

test('DeepSeek catalog distinguishes its conservative default from the API output maximum', () => {
  const provider = getProviderCatalog().providers.find(item => item.id === 'deepseek')!;
  const field = provider.configuration!.sections.flatMap(section => section.fields)
    .find(item => item.path === 'generationDefaults.maxOutputTokens')!;
  assert.equal(provider.configuration!.defaults.generationDefaults.maxOutputTokens, 8192);
  assert.equal(field.kind, 'integer');
  assert.equal('min' in field && field.min, 1);
  assert.equal('max' in field && field.max, 393_216);
});

test('presets only persist provider identities that passed qualification', () => {
  const catalog = getProviderCatalog();
  const selectable = new Set(catalog.providers.filter(provider => provider.selectable).map(provider => provider.id));
  const explicit = catalog.presets.filter(preset => preset.providerType);
  assert.equal(explicit.length > 0, true);
  assert.equal(explicit.every(preset => selectable.has(preset.providerType!)), true);
  assert.equal(catalog.presets.some(preset => preset.id === 'llama-cpp' && preset.providerType === 'llama-cpp'), true);
});
