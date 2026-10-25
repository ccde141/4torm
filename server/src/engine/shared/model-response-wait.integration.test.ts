import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM } from './llm-bridge.js';

const MINUTE = 60_000;
for (const protocol of ['openai-chat-completions', 'anthropic-messages'] as const) {
  test(`${protocol}: prefill and thinking use one renewable response wait`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-response-wait-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
      id: 'fixture', baseUrl: 'http://127.0.0.1:9/v1', models: ['model'], protocol,
    }] }));
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let sent!: () => void; const started = new Promise<void>(resolve => { sent = resolve; });
    let thought!: () => void; const thinking = new Promise<void>(resolve => { thought = resolve; });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let requestSignal!: AbortSignal;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      requestSignal = init.signal!;
      const body = new ReadableStream<Uint8Array>({ start(value) {
        controller = value;
        requestSignal.addEventListener('abort', () => value.error(requestSignal.reason), { once: true });
      } });
      sent(); return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const operation = callLLM({ dataDir, fullModelKey: 'fixture:model',
      messages: [{ role: 'user', content: 'read long input' }], onChunk: () => {}, onReasoning: () => thought() });
    const checked = assert.rejects(operation, error => !!error && typeof error === 'object' && 'data' in error
      && (error.data as { code: string }).code === 'MODEL_RESPONSE_TIMEOUT');
    await started;
    t.mock.timers.tick(4 * MINUTE); assert.equal(requestSignal.aborted, false);
    const payload = protocol === 'anthropic-messages'
      ? { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'working' } }
      : { choices: [{ delta: { reasoning_content: 'working' }, finish_reason: null }] };
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
    await thinking;
    t.mock.timers.tick(29 * MINUTE); assert.equal(requestSignal.aborted, false);
    t.mock.timers.tick(MINUTE); await checked;
  });
}

test('a model-specific ninety minute wait reaches the actual request without becoming provider JSON', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slow-prefill-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'http://127.0.0.1:9/v1', models: ['slow'], modelResponseWaitMinutes: { slow: 90 },
  }] }));
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.ok(!String(init.body).includes('modelResponseWaitMinutes'));
    assert.ok('dispatcher' in init);
    t.mock.timers.tick(89 * MINUTE); assert.equal(init.signal?.aborted, false);
    return Response.json({ choices: [{ message: { content: 'complete' }, finish_reason: 'stop' }] });
  });
  const result = await callLLM({ dataDir, fullModelKey: 'fixture:slow', messages: [{ role: 'user', content: 'long input' }] });
  assert.equal(result.content, 'complete');
});
