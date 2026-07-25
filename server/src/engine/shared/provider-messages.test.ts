import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAssistantContextMessage,
  extractReasoningEnvelope,
  mapProviderMessages,
} from './provider-messages.js';

test('assistant reasoning is preserved beside native tool calls', () => {
  const messages = mapProviderMessages([{
    role: 'assistant', content: '', reasoningContent: '先检查目录',
    toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{"path":"a"}' }],
  }], new Map([['read_file', 'read_file']]), {
    baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.7-code',
  });

  assert.deepEqual(messages, [{
    role: 'assistant', content: null, reasoning_content: '先检查目录',
    tool_calls: [{
      id: 'tc-1', type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a"}' },
    }],
  }]);
});

test('generic OpenAI-compatible providers omit private reasoning history fields', () => {
  const messages = mapProviderMessages([{
    role: 'assistant', content: 'answer', reasoningContent: 'private reasoning',
  }], new Map(), {
    baseUrl: 'https://example.test/v1', model: 'custom-model',
  });

  assert.deepEqual(messages, [{ role: 'assistant', content: 'answer' }]);
});

test('GLM preserved thinking is replayed beside tool calls', () => {
  const messages = mapProviderMessages([{
    role: 'assistant', content: '', reasoningContent: '先读取项目结构',
    toolCalls: [{ id: 'tc-glm', name: 'read_file', arguments: '{"path":"README.md"}' }],
  }], new Map(), {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-5.2',
  });

  assert.equal(messages[0].reasoning_content, '先读取项目结构');
});

test('DashScope preserved thinking is replayed beside tool calls', () => {
  const messages = mapProviderMessages([{
    role: 'assistant', content: '', reasoningContent: '先分析依赖',
    toolCalls: [{ id: 'tc-qwen', name: 'read_file', arguments: '{"path":"package.json"}' }],
  }], new Map(), {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-max',
  });

  assert.equal(messages[0].reasoning_content, '先分析依赖');
});

test('structured reasoning blocks survive storage and provider replay unchanged', () => {
  const blocks = [
    { type: 'reasoning.encrypted', data: 'opaque-signature' },
    { type: 'reasoning.summary', summary: 'checked files' },
  ];
  const messages = mapProviderMessages([{
    role: 'assistant', content: '',
    reasoningEnvelope: { field: 'reasoning_details', value: blocks },
    toolCalls: [{ id: 'tc-router', name: 'read_file', arguments: '{}' }],
  }], new Map(), {
    baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet',
  });

  assert.strictEqual(messages[0].reasoning_details, blocks);
  assert.deepEqual(extractReasoningEnvelope({ reasoning_details: blocks }), {
    field: 'reasoning_details', value: blocks,
  });
});

test('generic providers do not receive structured reasoning from another protocol', () => {
  const messages = mapProviderMessages([{
    role: 'assistant', content: 'answer',
    reasoningEnvelope: { field: 'reasoning_details', value: [{ type: 'opaque' }] },
  }], new Map(), {
    baseUrl: 'https://example.test/v1', model: 'custom-model',
  });

  assert.equal('reasoning_details' in messages[0], false);
});

test('assistant context keeps the opaque reasoning envelope beside visible reasoning', () => {
  const envelope = {
    field: 'reasoning_details' as const,
    value: [{ type: 'reasoning.encrypted', data: 'signed' }],
  };
  const message = createAssistantContextMessage(
    '', [{ id: 'tc-1', name: 'read_file', arguments: '{}' }], '可见摘要', envelope,
  );

  assert.strictEqual(message.reasoningEnvelope, envelope);
  assert.equal(message.reasoningContent, '可见摘要');
});

test('OpenAI-compatible user images become image_url content blocks', () => {
  const messages = mapProviderMessages([{
    role: 'user', content: '描述图片',
    images: [{
      id: 'image-1', name: 'screen.png', mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
    }],
  }], new Map(), {
    baseUrl: 'https://example.test/v1', model: 'vision-model',
  });

  assert.deepEqual(messages, [{
    role: 'user',
    content: [
      { type: 'text', text: '描述图片' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ],
  }]);
});
