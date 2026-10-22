import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage, ToolImageRef } from '../types.js';
import { prepareToolImageContext } from './tool-image-context.js';
import { compileModelMessages } from './compile.js';
import { buildAnthropicRequest } from '../provider-transports/anthropic.js';
import { serializeCompactionMessages } from '../compaction/estimate.js';

const ref = (id: string): ToolImageRef => ({ id, name: `${id}.png`, mimeType: 'image/png', size: 10 });
const image = async (_dir: string, item: ToolImageRef) => ({ ...item,
  dataUrl: 'data:image/png;base64,cGl4ZWxz' });
const settings = { identity: { baseUrl: 'https://example.test/v1', model: 'demo' }, forwardToolNames: new Map<string, string>() };

test('request hydration limits tool images, reports missing/unsupported images, and leaves archive references intact', async () => {
  const messages: ContextMessage[] = ['old', 'middle', 'new'].map(id => ({
    role: 'tool', toolCallId: id, content: 'metadata', toolImages: [ref(id)],
  }));
  const original = structuredClone(messages);
  const hydrated = await prepareToolImageContext(messages, { dataDir: '', vision: 'supported', readImage: image });
  assert.equal(hydrated[0].images, undefined);
  assert.match(hydrated[0].content, /未随本次请求发送/);
  assert.equal(hydrated[1].images?.length, 1);
  assert.equal(hydrated[2].images?.length, 1);
  assert.deepEqual(messages, original);
  const again = await prepareToolImageContext([hydrated[1]], { dataDir: '', vision: 'unsupported' });
  assert.equal(again[0].images, undefined);
  assert.doesNotMatch(serializeCompactionMessages(hydrated), /cGl4ZWxz/);
  for (const vision of ['unsupported', undefined] as const) {
    const downgraded = await prepareToolImageContext(messages, { dataDir: '', vision,
      readImage: async () => { throw new Error('must not read'); } });
    assert.equal(downgraded.some(item => item.images?.length), false);
    assert.match(downgraded[2].content, /工具图片未发送/);
  }
  const missing = await prepareToolImageContext(messages.slice(-1), { dataDir: '', vision: 'supported',
    readImage: async () => { throw new Error('missing'); } });
  assert.match(missing[0].content, /无法读取/);
  assert.equal(missing[0].images, undefined);
});

test('native batches complete every tool result before OpenAI image input, while Anthropic embeds image results', async () => {
  const tools = ['a', 'b'].map(id => ({ id, name: 'capture', arguments: '{}' }));
  const messages = await prepareToolImageContext([
    { role: 'user', content: 'inspect' },
    { role: 'assistant', content: '', toolCalls: tools },
    ...tools.map(call => ({ role: 'tool' as const, toolCallId: call.id,
      content: `metadata-${call.id}`, toolImages: [ref(call.id)] })),
  ], { dataDir: '', vision: 'supported', readImage: image });
  const openai = compileModelMessages(messages, settings);
  assert.deepEqual(openai.map(item => item.role), ['user', 'assistant', 'tool', 'tool', 'user']);
  assert.equal(typeof openai[2].content, 'string');
  assert.equal((openai[4].content as unknown[]).length, 3);
  const request = buildAnthropicRequest({ baseUrl: 'https://example.test/v1', model: 'demo', stream: false,
    maxTokens: 64, messages, tools: [{ name: 'capture', description: '', parameters: { type: 'object' } }] });
  const results = request.body.messages[2].content;
  assert.deepEqual(results.map((item: { type: string }) => item.type), ['tool_result', 'tool_result']);
  assert.deepEqual(results[0].content.map((item: { type: string }) => item.type), ['text', 'image']);
});

test('tool image references and pixels survive native/text transport switches without inventing human input', async () => {
  const native: ContextMessage[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'one', name: 'capture', arguments: '{"count":2}' }] },
    { role: 'tool', toolCallId: 'one', content: 'metadata', toolImages: [ref('one')] },
  ];
  const hydrated = await prepareToolImageContext(native, { dataDir: '', vision: 'supported', readImage: image });
  const text = compileModelMessages(hydrated, { ...settings, toolTransport: 'text' });
  assert.equal(text[1].role, 'user');
  assert.equal((text[1].content as Array<{type: string}>)[1].type, 'image_url');
  const textHistory: ContextMessage[] = [
    { role: 'assistant', content: '{"type":"tool_call","name":"capture","arguments":{"count":2}}' },
    { role: 'user', content: '{"type":"tool_result","name":"capture","ok":true,"content":"metadata"}',
      toolImages: [ref('one')] },
  ];
  const restored = compileModelMessages(await prepareToolImageContext(textHistory,
    { dataDir: '', vision: 'supported', readImage: image }), settings);
  assert.deepEqual(restored.map(item => item.role), ['assistant', 'tool', 'user']);
  assert.equal((restored[2].content as unknown[]).length, 2);
  const unavailable = compileModelMessages(await prepareToolImageContext(textHistory,
    { dataDir: '', vision: 'unsupported' }), settings);
  assert.deepEqual(unavailable.map(item => item.role), ['assistant', 'tool']);
  assert.match(String(unavailable[1].content), /工具图片未发送/);
});
