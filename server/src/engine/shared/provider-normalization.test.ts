import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatRequestBody, resolveProviderModelCapabilities } from './provider-normalization.js';
import { resolveProviderAdapter } from './provider-adapters/registry.js';

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

test('provider adapters resolve by explicit module priority with a generic fallback', () => {
  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.7-code',
  }).id, 'kimi');
  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro',
  }).id, 'deepseek');
  assert.equal(resolveProviderAdapter({
    baseUrl: 'http://localhost:1234/v1', model: 'qwen-local',
  }).id, 'openai-compatible');
});

test('GLM 5 enables preserved thinking on the official BigModel endpoint', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-5.2' },
    { ...baseBody, model: 'glm-5.2' },
  );

  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-5.2',
  }).id, 'zhipu-glm');
  assert.deepEqual(body.thinking, { type: 'enabled', clear_thinking: false });
  assert.equal(resolveProviderModelCapabilities({
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-5.2',
  }).reasoningHistory, 'reasoning_content');
});

test('local and older GLM models keep generic OpenAI-compatible behavior', () => {
  assert.equal(resolveProviderAdapter({
    baseUrl: 'http://localhost:1234/v1', model: 'glm-5.2',
  }).id, 'openai-compatible');
  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-4-flash',
  }).id, 'openai-compatible');
});

test('DeepSeek reasoning models remove incompatible sampling fields', () => {
  const body = normalizeChatRequestBody(
    { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' },
    {
      ...baseBody,
      model: 'deepseek-v4-pro',
      top_p: 0.9,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
    },
  );

  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal('temperature' in body, false);
  assert.equal('top_p' in body, false);
  assert.equal('presence_penalty' in body, false);
  assert.equal('frequency_penalty' in body, false);
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

test('DashScope Qwen reasoning models enable and preserve thinking', () => {
  for (const baseUrl of [
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  ]) {
    const identity = { baseUrl, model: 'qwen3-max' };
    const body = normalizeChatRequestBody(identity, { ...baseBody, model: identity.model });
    assert.equal(resolveProviderAdapter(identity).id, 'dashscope');
    assert.equal(body.enable_thinking, true);
    assert.equal(body.preserve_thinking, true);
    assert.equal('thinking_budget' in body, false);
    assert.equal(resolveProviderModelCapabilities(identity).reasoningHistory, 'reasoning_content');
  }
});

test('DashScope non-reasoning and locally hosted Qwen models keep generic behavior', () => {
  assert.equal(resolveProviderAdapter({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo',
  }).id, 'openai-compatible');
  assert.equal(resolveProviderAdapter({
    baseUrl: 'http://localhost:1234/v1', model: 'qwen3-max',
  }).id, 'openai-compatible');
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
    baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3',
    profile: 'openai-compatible',
  }).id, 'openai-compatible');

  const identity = {
    baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-235B-A22B',
    profile: 'siliconflow-thinking',
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
