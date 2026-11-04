import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnthropicResponse } from './anthropic.js';
import { parseAnthropicSSEStream } from './anthropic-stream.js';
import { isProviderContextOverflow } from '../provider-request-error.js';
import type { TokenUsage } from '../llm-bridge.js';
import { FrameworkError } from '../framework-error.js';

const tool = { name: 'audit_tool', description: '', parameters: { type: 'object' } };
const toolEvents = [
  { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 100000,
    cache_creation_input_tokens: 2000, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: tool.name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"value":1}' } },
];
function sse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
}
function completed(stop_reason = 'tool_use'): unknown[] {
  return [...toolEvents, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 20 } }, { type: 'message_stop' }];
}

test('Anthropic requires both the message end and all content-block ends', async () => {
  for (const [name, events] of [
    ['missing message end', completed().slice(0, -1)],
    ['unclosed tool block', completed().filter((_, i) => i !== 3)],
  ] as const) {
    await assert.rejects(parseAnthropicSSEStream(sse([...events]), new Map(), () => {}),
      (error: unknown) => error instanceof FrameworkError && error.data.code === 'MODEL_STREAM_INCOMPLETE', name);
  }
});

test('Anthropic completed streams preserve tool arguments and cached usage, then release the socket', async () => {
  let canceled = false;
  const usage: TokenUsage[] = [];
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(completed().map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
  }, cancel() { canceled = true; } }));
  const result = await parseAnthropicSSEStream(response, new Map(), () => {}, undefined, undefined,
    item => usage.push(item));
  assert.equal(result.finishReason, 'tool_calls'); assert.equal(canceled, true);
  assert.deepEqual(result.toolCalls, [{ id: 't1', name: tool.name, arguments: '{"value":1}' }]);
  assert.deepEqual(result.usage, { promptTokens: 102100, completionTokens: 20, totalTokens: 102120 });
  assert.deepEqual(usage.at(-1), result.usage); assert.equal(result.usageComplete, true);
});

test('Anthropic classifies context exhaustion for compaction and does not pretend a server-tool pause is completion', async () => {
  assert.throws(() => parseAnthropicResponse({ content: [], stop_reason: 'model_context_window_exceeded' }, new Map()),
    isProviderContextOverflow);
  const usage: TokenUsage[] = [];
  await assert.rejects(parseAnthropicSSEStream(sse(completed('model_context_window_exceeded')), new Map(), () => {},
    undefined, undefined, item => usage.push(item)), isProviderContextOverflow);
  assert.equal(usage.at(-1)?.promptTokens, 102100); assert.equal(usage.at(-1)?.completionTokens, 20);
  assert.throws(() => parseAnthropicResponse({ content: [], stop_reason: 'pause_turn' }, new Map()),
    (error: unknown) => error instanceof FrameworkError && error.data.code === 'MODEL_PROVIDER_CONTINUATION_UNSUPPORTED');
});
