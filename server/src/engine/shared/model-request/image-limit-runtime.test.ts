import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM, estimateCurrentInput } from '../llm-bridge.js';
import { estimateRequestInput, observeModelRequests, type ModelRequestUsageEvent } from '../model-request-usage.js';
import type { ContextMessage } from '../types.js';

async function fixture(t: test.TestContext, protocol = 'openai-chat-completions') {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-image-runtime-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://image-runtime.invalid/v1', protocol,
  }] }));
  const messages: ContextMessage[] = [{ role: 'user', content: 'Retain this request and my recent pictures',
    images: Array.from({ length: 4 }, (_, index) => ({ id: `image-${index}`, name: `${index}.png`,
      mimeType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from(`fixture-${index}`).toString('base64')}` })) }];
  return { dataDir, fullModelKey: 'fixture:model', messages };
}

for (const protocol of ['openai-chat-completions', 'anthropic-messages']) {
  test(`${protocol} prunes old pictures on rejection, accounts each attempt and reuses the accepted budget`, async t => {
    const params = await fixture(t, protocol);
    const original = structuredClone(params.messages);
    const images: number[] = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      images.push(estimateRequestInput(body).images);
      if (images.length === 1) return new Response(JSON.stringify({ error: { message: 'at most 2 images allowed' } }), { status: 400 });
      return new Response(JSON.stringify(protocol === 'anthropic-messages'
        ? { content: [{ type: 'text', text: 'recent pictures received' }], stop_reason: 'end_turn', usage: { input_tokens: 40, output_tokens: 4 } }
        : { choices: [{ message: { content: 'recent pictures received' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 4, total_tokens: 44 } }));
    });
    const events: ModelRequestUsageEvent[] = [];
    const result = await observeModelRequests(event => events.push(event), () => callLLM(params));
    assert.equal(result.content, 'recent pictures received');
    assert.deepEqual(images, [4, 2]);
    assert.deepEqual(params.messages, original);
    const terminal = events.filter(event => event.request.state === 'failed' || event.request.state === 'completed');
    assert.deepEqual(terminal.map(event => event.request.state), ['failed', 'completed']);
    assert.notEqual(terminal[0].request.id, terminal[1].request.id);
    assert.deepEqual(terminal.map(event => event.request.imageCount), [4, 2]);
    assert.equal((await estimateCurrentInput(params)).images, 2);
    await callLLM(params);
    assert.deepEqual(images, [4, 2, 2]);
  });
}

test('an image-related error after streamed output is surfaced without another model request', async t => {
  const params = await fixture(t);
  let calls = 0;
  const chunks: string[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n'
      + 'data: {"error":{"message":"too many images"}}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(callLLM({ ...params, onChunk: chunk => chunks.push(chunk) }), /图片输入超过限制/);
  assert.equal(calls, 1);
  assert.equal(chunks.join(''), 'partial answer');
});

test('reasoning alone also prevents image recovery from replaying a started response', async t => {
  const params = await fixture(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('data: {"choices":[{"delta":{"reasoning_content":"reasoning started"}}]}\n\n'
      + 'data: {"error":{"message":"too many images"}}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(callLLM({ ...params, onChunk: () => {} }), /图片输入超过限制/);
  assert.equal(calls, 1);
});
