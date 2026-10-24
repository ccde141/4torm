import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callLLM } from './llm-bridge.js';
import { createModelRequestUsage, estimateRequestInput, observeModelRequests,
  parseModelUsageProgress, recordModelRequest, type ModelRequestUsage, type ModelRequestUsageEvent } from './model-request-usage.js';

const usage = { promptTokens: 50, completionTokens: 4, totalTokens: 54 };
const snapshot = (id: string, patch: Partial<ModelRequestUsage> = {}): ModelRequestUsage => ({
  id, purpose: 'conversation', state: 'completed', startedAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:01.000Z', estimatedInputTokens: 80, imageCount: 0,
  usage, usageComplete: true, ...patch,
});

test('streaming replacements, replay, failures, and compaction keep one known cumulative total', () => {
  let ledger = recordModelRequest(undefined, snapshot('first', { state: 'streaming', usageComplete: false }));
  ledger = recordModelRequest(ledger, snapshot('first'));
  ledger = recordModelRequest(ledger, snapshot('first'));
  assert.equal(ledger.calls, 1);
  assert.equal(ledger.total.totalTokens, 54);
  ledger = recordModelRequest(ledger, snapshot('second', { usage: undefined, usageComplete: false, state: 'failed' }));
  assert.equal(ledger.latest?.id, 'second', 'same-millisecond requests select the later insertion');
  assert.equal(ledger.total.totalTokens, 54);
  assert.equal(ledger.complete, false);
  ledger = recordModelRequest(ledger, snapshot('summary', { purpose: 'compaction' }));
  assert.equal(ledger.latest?.id, 'second');
  assert.equal(ledger.total.totalTokens, 108);
  assert.equal(recordModelRequest(ledger, snapshot('first', { updatedAt: '2026-10-24T00:00:00.001Z' })), ledger);
  assert.deepEqual(parseModelUsageProgress(ledger), ledger);
});

test('compiled input estimate includes tool schemas and images without counting base64 as text', () => {
  const plain = estimateRequestInput({ messages: [{ role: 'user', content: 'hello' }] });
  const tools = estimateRequestInput({ messages: [{ role: 'user', content: 'hello' }], tools: [{
    name: 'write_file', input_schema: { type: 'object', properties: { content: { type: 'string' } } },
  }] });
  assert.ok(tools.tokens > plain.tokens);
  const image = (length: number) => estimateRequestInput({ messages: [{ role: 'user', content: [
    { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(length)}` } },
  ] }] });
  assert.deepEqual(image(10), image(500_000));
  assert.equal(image(10).images, 1);
});

test('nested execution observers isolate targets while owner adapters may explicitly inherit', async () => {
  const parent: ModelRequestUsageEvent[] = [];
  const child: ModelRequestUsageEvent[] = [];
  const owner: ModelRequestUsageEvent[] = [];
  await observeModelRequests(event => parent.push(event), async () => {
    createModelRequestUsage({ messages: [] }).finish('completed', usage);
    await observeModelRequests(event => child.push(event), async () => {
      createModelRequestUsage({ messages: [] }).finish('completed', usage);
    });
    await observeModelRequests(event => owner.push(event), async () => {
      createModelRequestUsage({ messages: [] }).finish('completed', usage);
    }, true);
    await observeModelRequests(undefined, async () => {
      createModelRequestUsage({ messages: [] }).finish('completed', usage);
    });
  });
  assert.equal(parent.length, 4);
  assert.equal(child.length, 2);
  assert.equal(owner.length, 2);
  assert.notEqual(child[0].request.id, parent[0].request.id);
});

test('cancellation before a provider slot is acquired does not invent a sent call', async () => {
  const events: ModelRequestUsageEvent[] = [];
  await observeModelRequests(event => events.push(event), async () => {
    createModelRequestUsage({ messages: [] }).finish('cancelled');
  });
  const ledger = recordModelRequest(undefined, events.at(-1)!.request);
  assert.equal(ledger.calls, 0);
  assert.equal(ledger.total.totalTokens, 0);
});

for (const protocol of ['openai-chat', 'anthropic-messages'] as const) {
  test(`${protocol} exposes provider usage before a stream interruption and preserves partial measurements`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-request-usage-'));
    const originalFetch = globalThis.fetch;
    const events: ModelRequestUsageEvent[] = [];
    await fs.writeFile(path.join(dir, 'providers.json'), JSON.stringify({ providers: [{
      id: 'pvd_test', baseUrl: 'https://example.test/v1', models: ['test-model'], protocol,
    }] }));
    let reads = 0;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(new TextEncoder().encode(protocol === 'openai-chat'
          ? 'data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":4,"total_tokens":54}}\n\n'
          : 'data: {"type":"message_start","message":{"usage":{"input_tokens":50}}}\n\n'));
        else controller.error(new Error('fixture interrupted stream'));
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
    try {
      await assert.rejects(observeModelRequests(event => events.push(event), () => callLLM({
        dataDir: dir, fullModelKey: 'pvd_test:test-model',
        messages: [{ role: 'user', content: 'fixture' }], onChunk: () => {},
      })), /fixture interrupted stream/);
      const failed = events.at(-1)!.request;
      assert.equal(failed.state, 'failed');
      assert.equal(failed.usage?.promptTokens, 50);
      assert.equal(failed.usageComplete, false);
      assert.equal(new Set(events.map(event => event.request.id)).size, 1);
      assert.ok(events.some(event => event.request.state === 'streaming'));
    } finally { globalThis.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
  });
}

test('a completed input-only report stays incomplete and separate partial OpenAI reports merge', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-partial-usage-'));
  const originalFetch = globalThis.fetch;
  await fs.writeFile(path.join(dir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'pvd_test', baseUrl: 'https://example.test/v1', models: ['test-model'],
  }] }));
  try {
    for (const includeOutput of [false, true]) {
      const events: ModelRequestUsageEvent[] = [];
      globalThis.fetch = async () => new Response([
        'data: {"choices":[],"usage":{"prompt_tokens":50}}',
        ...(includeOutput ? ['data: {"choices":[],"usage":{"completion_tokens":4}}'] : []),
        'data: [DONE]', '',
      ].join('\n\n'));
      await observeModelRequests(event => events.push(event), () => callLLM({ dataDir: dir,
        fullModelKey: 'pvd_test:test-model', messages: [{ role: 'user', content: 'fixture' }], onChunk: () => {} }));
      const final = events.at(-1)!.request;
      assert.equal(final.usageComplete, includeOutput);
      assert.equal(final.usage?.promptTokens, 50);
      assert.equal(final.usage?.completionTokens, includeOutput ? 4 : 0);
      assert.equal(recordModelRequest(undefined, final).total.totalTokens, includeOutput ? 54 : 50);
    }
  } finally { globalThis.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});
