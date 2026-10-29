import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runReActLoopNative } from './react/native-loop.js';
import { runReActLoop } from './react/text-loop.js';
import { callLLM } from './llm-bridge.js';
import { createCompactionCaller } from './compaction/controller.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from './compaction/policy.js';
import type { ModelRequestUsageEvent } from './model-request-usage.js';
import type { ContextMessage } from './types.js';

function stream(content: string, name?: string) {
  const delta = name ? { tool_calls: [{ index: 0, id: 'write-once', type: 'function',
    function: { name, arguments: '{}' } }] } : { content };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: name ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } });
}

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-retry-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'local',
    baseUrl: 'http://127.0.0.1:9/v1', models: ['model'] }] }));
  return dataDir;
}

test('a silent request timeout retries with a fresh model wait and completes', async t => {
  const dataDir = await fixture(t);
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'local',
    baseUrl: 'http://127.0.0.1:9/v1', models: ['model'], modelResponseWaitMinutes: { model: 1 } }] }));
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let sent!: () => void; const started = new Promise<void>(resolve => { sent = resolve; });
  let calls = 0; let originalSignal!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    if (++calls > 1) return stream('complete');
    originalSignal = init.signal!;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      originalSignal.addEventListener('abort', () => controller.error(originalSignal.reason), { once: true });
    } });
    sent(); return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const operation = callLLM({ dataDir, fullModelKey: 'local:model', messages: [{ role: 'user', content: 'work' }],
    onChunk: () => {} });
  await started; t.mock.timers.tick(60_000); assert.equal(originalSignal.aborted, true);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(1_000);
  assert.equal((await operation).content, 'complete'); assert.equal(calls, 2);
});

for (const partial of [false, true]) test(`socket loss after headers retries only before output (partial: ${partial})`, async t => {
  const dataDir = await fixture(t); let calls = 0; const chunks: string[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls > 1) return stream('complete');
    let sent = false;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (partial && !sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })}\n\n`));
        return;
      }
      controller.error(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }));
    } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const operation = callLLM({ dataDir, fullModelKey: 'local:model', messages: [{ role: 'user', content: 'work' }],
    onChunk: chunk => chunks.push(chunk) });
  if (partial) {
    await assert.rejects(operation); assert.equal(calls, 1); assert.deepEqual(chunks, ['partial']);
  } else {
    assert.equal((await operation).content, 'complete'); assert.equal(calls, 2);
  }
});

for (const native of [true, false]) test(`${native ? 'native' : 'text'} request retry keeps completed tools and counts every attempt`, async t => {
  const dataDir = await fixture(t); let calls = 0; let writes = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return native ? stream('', 'write')
      : stream('{"type":"tool_call","name":"write","arguments":{}}');
    if (calls === 2) return new Response('{"error":{"message":"unavailable"}}', { status: 503 });
    return stream('complete');
  });
  const requests: ModelRequestUsageEvent[] = [];
  const input = { messages: [{ role: 'user' as const, content: 'write then inspect' }],
    tools: { call: async () => { writes++; return 'saved'; } },
    llm: { call: (messages: ContextMessage[], _options: unknown, onChunk?: (chunk: string) => void,
      signal?: AbortSignal, tools?: Parameters<typeof callLLM>[0]['tools']) =>
      callLLM({ dataDir, fullModelKey: 'local:model', messages, onChunk, signal, tools }) },
    onEvent: (event: { type: string }) => { if (event.type === 'model-request') requests.push(event as ModelRequestUsageEvent); } };
  const result = native ? await runReActLoopNative({ ...input,
    toolDefs: [{ name: 'write', description: 'write', parameters: { type: 'object' } }] })
    : await runReActLoop({ ...input, allowedTools: ['write'] });
  assert.equal(result.termination.status, 'succeeded'); assert.equal(result.content, 'complete');
  assert.equal(writes, 1); assert.equal(calls, 3);
  const final = new Map(requests.map(event => [event.request.id, event.request]));
  assert.deepEqual([...final.values()].map(request => request.state), ['completed', 'failed', 'completed']);
});

test('a silent failed summary request retries the same complete history and resumes the original task', async t => {
  const dataDir = await fixture(t);
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: true,
    thresholds: { ...policy.thresholds, monsoon: 1_000 } });
  const sources: string[] = []; let summaryCalls = 0; let failedSource: string | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.messages.at(-1).content.includes('你负责把已有会话整理')) {
      const source = JSON.stringify(body.messages.slice(0, -1)); sources.push(source);
      if (++summaryCalls === 1) { failedSource = source; return new Response('{}', { status: 503 }); }
      return stream('TASK-42：已记录旧事实，当前任务未完成。');
    }
    return stream('TASK-42 complete');
  });
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' },
    { role: 'user', content: '旧事实'.repeat(8_000) }, { role: 'assistant', content: '已核验结果'.repeat(8_000) },
    ...[1, 2, 3].flatMap(index => [{ role: 'user' as const, content: `近期要求 ${index}` },
      { role: 'assistant' as const, content: `近期结果 ${index}` }]),
    { role: 'user', content: 'TASK-42: continue original task' }];
  const result = await runReActLoopNative({ messages, toolDefs: [], onEvent: () => {},
    llm: createCompactionCaller({ dataDir, area: 'monsoon', kind: 'conversation', model: 'local:model',
      scopeKey: 'fixture-task', protectedPrefixCount: 1, resolveSummaryBudget: async () => 200_000,
      llm: { call: (context, _options, onChunk, signal) => callLLM({ dataDir,
        fullModelKey: 'local:model', messages: context, onChunk, signal }) } }) });
  assert.equal(result.termination.status, 'succeeded'); assert.equal(result.content, 'TASK-42 complete');
  assert.ok(failedSource); assert.equal(sources.filter(source => source === failedSource).length, 2);
  assert.equal(sources.length, 2);
  assert.ok(sources.every(source => source === sources[0]));
  assert.ok(messages.some(message => message.content.includes('TASK-42: continue original task')));
});
