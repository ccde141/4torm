import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM } from './llm-bridge.js';
import { isProviderContextOverflow } from './provider-request-error.js';

async function withProvider(run: (dataDir: string) => Promise<void>) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-anthropic-'));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'pvd_claude', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'secret',
    protocol: 'anthropic-messages', models: ['claude-test'],
  }] }));
  try { await run(dataDir); } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

test('Anthropic output control cancels its reader and keeps the final accepted text or thinking delta', async t => {
  await withProvider(async dataDir => {
    for (const kind of ['thinking', 'text']) {
      let canceled = false;
      let accepted = false;
      const events = [
        { type: 'content_block_start', index: 0, content_block: { type: kind } },
        { type: 'content_block_delta', index: 0, delta: kind === 'text'
          ? { type: 'text_delta', text: '正文' } : { type: 'thinking_delta', thinking: '思考' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '不应消费' } },
      ];
      let closeTimer: NodeJS.Timeout;
      t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode(events
          .map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
          closeTimer = setTimeout(() => controller.close(), 100); },
        cancel() { canceled = true; },
      })));
      const result = await callLLM({ dataDir, fullModelKey: 'pvd_claude:claude-test',
        messages: [{ role: 'user', content: '压缩' }], onChunk: () => { accepted = true; },
        onReasoning: () => { accepted = true; }, outputControl: { shouldStop: () => accepted },
      });
      clearTimeout(closeTimer!);
      assert.equal(result.content, kind === 'text' ? '正文' : '');
      assert.equal(result.reasoningContent, kind === 'thinking' ? '思考' : undefined);
      assert.equal(result.finishReason, 'length');
      assert.equal(canceled, true);
    }
  });
});

test('Anthropic SSE capacity errors retain their recovery classification', async t => {
  await withProvider(async dataDir => {
    t.mock.method(globalThis, 'fetch', async () => new Response(
      'event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    await assert.rejects(callLLM({ dataDir, fullModelKey: 'pvd_claude:claude-test',
      messages: [{ role: 'user', content: 'test' }], onChunk: () => {} }), isProviderContextOverflow);
  });
});

test('Anthropic requests apply custom provider parameters without exposing system', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-anthropic-custom-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'pvd_claude', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'secret',
    protocol: 'anthropic-messages', models: ['claude-test'],
    customRequestParameters: { top_k: 12 },
  }] }));
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.top_k, 12);
    assert.equal(body.system, 'trusted system');
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
    }), { status: 200 });
  });

  const result = await callLLM({
    dataDir, fullModelKey: 'pvd_claude:claude-test',
    messages: [{ role: 'system', content: 'trusted system' }, { role: 'user', content: 'hi' }],
  });
  assert.equal(result.content, 'ok');
});

test('callLLM uses Anthropic transport for an explicitly configured provider', async () => {
  await withProvider(async dataDir => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody: any;
    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const result = await callLLM({
        dataDir, fullModelKey: 'pvd_claude:claude-test',
        messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hi' }],
      });
      assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
      assert.equal(capturedBody.system, 'system');
      assert.equal(result.content, 'hello');
      assert.deepEqual(result.usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('callLLM parses Anthropic streaming text, thinking and tool use', async () => {
  await withProvider(async dataDir => {
    const originalFetch = globalThis.fetch;
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'working' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'ping' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 6 } },
      { type: 'message_stop' },
    ];
    globalThis.fetch = async () => new Response(
      events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
    const chunks: string[] = [];
    const thoughts: string[] = [];
    try {
      const result = await callLLM({
        dataDir, fullModelKey: 'pvd_claude:claude-test',
        messages: [{ role: 'user', content: 'work' }],
        tools: [{ name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } }],
        onChunk: chunk => chunks.push(chunk),
        onReasoning: chunk => thoughts.push(chunk),
      });
      assert.deepEqual(chunks, ['working']);
      assert.deepEqual(thoughts, ['think']);
      assert.equal(result.finishReason, 'tool_calls');
      assert.deepEqual(result.toolCalls, [{ id: 'toolu_1', name: 'ping', arguments: '{}' }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
