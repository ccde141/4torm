import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM } from './llm-bridge.js';
import { createCompactionCaller } from './compaction/controller.js';
import { runReActLoopNative, type LLMCaller } from './react/native-loop.js';
import type { ContextMessage } from './types.js';

const tool = { name: 'write_once', description: '', parameters: { type: 'object' } };
function sse(events: unknown[]): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}
function anthropic(stop_reason: string, withTool = false): string {
  return sse([{ type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: withTool
      ? { type: 'tool_use', id: 'once', name: tool.name, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: withTool
      ? { type: 'input_json_delta', partial_json: '{}' } : { type: 'text_delta', text: 'TASK-42 done' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 10 } }, { type: 'message_stop' }]);
}

async function fixture(t: test.TestContext, protocol: 'anthropic-messages' | 'openai-chat-completions',
  respond: (request: number) => string) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compat-http-'));
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push({ url: request.url!, body: JSON.parse(body) });
    response.setHeader('content-type', 'text/event-stream'); response.end(respond(requests.length));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const port = (server.address() as { port: number }).port;
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'compat', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['model'], protocol,
  }] }));
  const llm: LLMCaller = { call: (messages, _options, onChunk, signal, tools) => callLLM({
    dataDir, fullModelKey: 'compat:model', messages, onChunk, signal, tools }) };
  return { dataDir, requests, llm };
}

for (const protocol of ['anthropic-messages', 'openai-chat-completions'] as const) {
  test(`${protocol} premature EOF through real HTTP never executes a partial tool`, async t => {
    const payload = protocol === 'anthropic-messages'
      ? anthropic('tool_use', true).split('data: {"type":"content_block_stop"')[0]
      : sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'once', type: 'function',
        function: { name: tool.name, arguments: '{}' } }] } }] }]);
    const { llm, requests } = await fixture(t, protocol, () => payload);
    let writes = 0;
    const result = await runReActLoopNative({ messages: [{ role: 'user', content: 'audit' }], llm,
      maxTurns: 3, toolDefs: [tool], onEvent: () => {}, tools: { call: async () => { writes++; return 'saved'; } } });
    assert.equal(result.termination.status, 'failed'); assert.equal(writes, 0); assert.equal(requests.length, 1);
    assert.equal(result.termination.error?.code, 'MODEL_STREAM_INCOMPLETE');
  });
}

test('Anthropic context stop through HTTP compacts and resumes without repeating an executed tool', async t => {
  const { dataDir, llm, requests } = await fixture(t, 'anthropic-messages', request => request === 1
    ? anthropic('tool_use', true) : anthropic(request === 2 ? 'model_context_window_exceeded' : 'end_turn'));
  const messages: ContextMessage[] = [{ role: 'system', content: 'rules' },
    { role: 'user', content: '旧事实'.repeat(8000) }, { role: 'assistant', content: '已核验结果'.repeat(8000) },
    ...[1, 2, 3].flatMap(index => [{ role: 'user' as const, content: `近期要求 ${index}` },
      { role: 'assistant' as const, content: `近期结果 ${index}` }]),
    { role: 'user', content: 'TASK-42: continue original task' }];
  let writes = 0, summaries = 0;
  let recoveryError: unknown;
  const caller = createCompactionCaller({ dataDir, area: 'monsoon', kind: 'conversation', model: 'compat:model',
    protectedPrefixCount: 1, resolveSummaryBudget: async () => 200000,
    summarize: async () => { summaries++; return 'TASK-42: write_once 已执行，继续原任务。'; }, llm });
  const recover = caller.recover!;
  caller.recover = async (...args) => {
    try { return await recover(...args); } catch (error) { recoveryError = error; throw error; }
  };
  const result = await runReActLoopNative({ messages, toolDefs: [tool], maxTurns: 5, onEvent: () => {},
    tools: { call: async () => { writes++; return 'saved'; } },
    llm: caller });
  assert.equal(recoveryError, undefined);
  assert.equal(result.termination.status, 'succeeded', JSON.stringify(result.termination));
  assert.equal(result.content, 'TASK-42 done');
  assert.equal(writes, 1); assert.equal(summaries, 1); assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.url === '/v1/messages'));
  assert.ok(JSON.stringify(requests[2].body).length < JSON.stringify(requests[1].body).length);
  assert.ok(JSON.stringify(requests[2].body).includes('TASK-42: continue original task'));
});
