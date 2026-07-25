import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM } from './llm-bridge.js';

async function withProvider(run: (dataDir: string) => Promise<void>) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-stream-end-'));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'pvd_test', baseUrl: 'https://example.test/v1', models: ['test-model'],
  }] }));
  try { await run(dataDir); } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

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
