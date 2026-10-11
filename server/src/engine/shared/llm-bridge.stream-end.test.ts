import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM } from './llm-bridge.js';
import { isProviderContextOverflow } from './provider-request-error.js';

async function withProvider(
  run: (dataDir: string) => Promise<void>,
  provider: Record<string, unknown> = {},
) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-stream-end-'));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'pvd_test', baseUrl: 'https://example.test/v1', models: ['test-model'], ...provider,
  }] }));
  try { await run(dataDir); } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

test('OpenAI output control cancels after a complete delta and preserves its accumulated content', async () => {
  await withProvider(async dataDir => {
    const originalFetch = globalThis.fetch;
    for (const { body, thought } of [
      { body: '', thought: '预算耗尽' }, { body: '正文', thought: '预算耗尽' }, { body: '正文', thought: '' },
    ]) {
      let canceled = false;
      const chunks: string[] = [];
      const thoughts: string[] = [];
      let close: () => void = () => {};
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) { close = () => { try { controller.close(); } catch {} };
          controller.enqueue(new TextEncoder().encode([
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: thought, content: body } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: '不应消费' } }] })}`,
        ].join('\n\n') + '\n\n')); },
        cancel() { canceled = true; },
      }));
      globalThis.fetch = async () => response;
      try {
        const result = await expectPromptCompletion(callLLM({ dataDir, fullModelKey: 'pvd_test:test-model',
          messages: [{ role: 'user', content: '压缩' }],
          onChunk: chunk => chunks.push(chunk), onReasoning: chunk => thoughts.push(chunk),
          outputControl: { shouldStop: () => thoughts.length > 0 || chunks.length > 0 },
        }), close);
        assert.equal(result.content, body);
        assert.deepEqual(chunks, body ? [body] : []);
        assert.equal(result.reasoningContent, thought || undefined);
        assert.equal(result.finishReason, 'length');
        assert.equal(canceled, true);
      } finally { globalThis.fetch = originalFetch; }
    }
  });
});

test('OpenAI-compatible SSE error packet is not swallowed as an empty successful response', async () => {
  await withProvider(async dataDir => {
    const stream = openSseResponse(['data: {"error":{"code":"context_length_exceeded","message":"prompt is too long"}}']);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => stream.response;
    try {
      await assert.rejects(callLLM({ dataDir, fullModelKey: 'pvd_test:test-model',
        messages: [{ role: 'user', content: 'test' }], onChunk: () => {} }), isProviderContextOverflow);
    } finally { globalThis.fetch = originalFetch; stream.close(); }
  });
});

test('MiniMax cumulative SSE values are emitted once and keep the latest reasoning envelope', async () => {
  await withProvider(async dataDir => {
    const stream = openSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: {
        reasoning_content: '先思考', reasoning_details: [{ type: 'reasoning.text', text: '先思考' }],
        content: '答',
      } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {
        reasoning_content: '先思考，再检查', reasoning_details: [{ type: 'reasoning.text', text: '先思考，再检查' }],
        content: '答案',
      }, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => stream.response;
    try {
      const chunks: string[] = [];
      const reasoning: string[] = [];
      const result = await expectPromptCompletion(callLLM({
        dataDir,
        fullModelKey: 'pvd_test:MiniMax-M3',
        messages: [{ role: 'user', content: 'test' }],
        onChunk: chunk => chunks.push(chunk),
        onReasoning: chunk => reasoning.push(chunk),
      }), stream.close);
      assert.equal(result.content, '答案');
      assert.equal(result.reasoningContent, '先思考，再检查');
      assert.equal(chunks.join(''), '答案');
      assert.equal(reasoning.join(''), '先思考，再检查');
      assert.deepEqual(result.reasoningEnvelope?.value, [
        { type: 'reasoning.text', text: '先思考，再检查' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, {
    baseUrl: 'https://api.minimaxi.com/v1', models: ['MiniMax-M3'],
    providerType: 'minimax', transport: 'openai-chat-completions',
  });
});

function openSseResponse(lines: string[]) {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      value.enqueue(encoder.encode(`${lines.join('\n\n')}\n\n`));
    },
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    close: () => {
      try { controller.close(); } catch { /* reader cancellation already closed the stream */ }
    },
  };
}

async function expectPromptCompletion<T>(promise: Promise<T>, close: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('stream waited for connection close after [DONE]')), 100);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    close();
  }
}

test('native tool stream finishes at DONE without waiting for connection close', async () => {
  await withProvider(async dataDir => {
    const stream = openSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
        index: 0, id: 'call_delegate', type: 'function',
        function: { name: 'delegate', arguments: '{"task":"make a riddle","context":"creative task","systemPrompt":"riddle writer"}' },
      }] }, finish_reason: 'tool_calls' }] })}`,
      'data: [DONE]',
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => stream.response;
    try {
      const result = await expectPromptCompletion(callLLM({
        dataDir,
        fullModelKey: 'pvd_test:test-model',
        messages: [{ role: 'user', content: 'delegate a riddle' }],
        tools: [{ name: 'delegate', description: 'delegate', parameters: { type: 'object' } }],
        onChunk: () => {},
      }), stream.close);
      assert.equal(result.finishReason, 'tool_calls');
      assert.equal(result.toolCalls?.[0]?.name, 'delegate');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('text tool stream finishes at DONE without waiting for connection close', async () => {
  await withProvider(async dataDir => {
    const envelope = JSON.stringify({
      type: 'tool_call', name: 'delegate',
      arguments: { task: 'make a riddle', context: 'creative task', systemPrompt: 'riddle writer' },
    });
    const stream = openSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: envelope }, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => stream.response;
    try {
      const result = await expectPromptCompletion(callLLM({
        dataDir,
        fullModelKey: 'pvd_test:test-model',
        messages: [{ role: 'user', content: 'delegate a riddle' }],
        onChunk: () => {},
      }), stream.close);
      assert.equal(result.content, envelope);
      assert.equal(result.finishReason, 'stop');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('structured request accepts an exact text tool envelope from the same response', async () => {
  await withProvider(async dataDir => {
    const envelope = JSON.stringify({
      type: 'tool_call', name: 'delegate',
      arguments: { task: 'make a riddle', context: 'creative task' },
    });
    const stream = openSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: envelope }, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => stream.response;
    try {
      const chunks: string[] = [];
      const result = await expectPromptCompletion(callLLM({
        dataDir,
        fullModelKey: 'pvd_test:test-model',
        messages: [{ role: 'user', content: 'delegate a riddle' }],
        tools: [{ name: 'delegate', description: 'delegate', parameters: { type: 'object' } }],
        onChunk: chunk => chunks.push(chunk),
      }), stream.close);
      assert.equal(result.finishReason, 'tool_calls');
      assert.equal(result.toolCalls?.[0]?.name, 'delegate');
      assert.equal(result.toolCalls?.[0]?.arguments, JSON.stringify({ task: 'make a riddle', context: 'creative task' }));
      assert.deepEqual(chunks, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('structured request does not execute ordinary or unknown JSON', async () => {
  await withProvider(async dataDir => {
    const content = '{"type":"tool_call","name":"not_offered","arguments":{}}';
    const stream = openSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => stream.response;
    try {
      const chunks: string[] = [];
      const result = await expectPromptCompletion(callLLM({
        dataDir,
        fullModelKey: 'pvd_test:test-model',
        messages: [{ role: 'user', content: 'answer normally' }],
        tools: [{ name: 'delegate', description: 'delegate', parameters: { type: 'object' } }],
        onChunk: chunk => chunks.push(chunk),
      }), stream.close);
      assert.equal(result.content, content);
      assert.equal(result.toolCalls, undefined);
      assert.equal(chunks.join(''), content);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('stream usage accepts final top-level and legacy choice counts without inventing missing usage', async () => {
  await withProvider(async dataDir => {
    const originalFetch = globalThis.fetch;
    const cases = [
      { chunks: [
        { choices: [{ delta: { content: 'A' }, finish_reason: 'stop', usage: {
          prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }] },
        { choices: [], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } },
      ], expected: { promptTokens: 8, completionTokens: 3, totalTokens: 11 } },
      { chunks: [
        { choices: [{ delta: { content: 'B' }, finish_reason: 'stop', usage: {
          prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }] },
        { choices: [], usage: { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 } },
      ], expected: { promptTokens: 12, completionTokens: 4, totalTokens: 16 } },
      { chunks: [{ choices: [{ delta: { content: 'C' }, finish_reason: 'stop' }] }], expected: undefined },
    ];
    try {
      for (const { chunks, expected } of cases) {
        globalThis.fetch = async (_input, init) => {
          const body = JSON.parse(String(init?.body));
          assert.deepEqual(body.stream_options, { include_usage: true });
          return new Response(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`,
            { headers: { 'Content-Type': 'text/event-stream' } });
        };
        const result = await callLLM({ dataDir, fullModelKey: 'pvd_test:test-model',
          messages: [{ role: 'user', content: 'test' }], onChunk: () => {} });
        assert.deepEqual(result.usage, expected);
      }
    } finally { globalThis.fetch = originalFetch; }
  });
});
