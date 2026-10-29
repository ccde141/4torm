import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callLLM } from './llm-bridge.js';
import { observeModelRequests, type ModelRequestUsageEvent } from './model-request-usage.js';
import type { ContextMessage } from './types.js';

const tool = { name: 'mcp:files:read', description: 'Read a file', parameters: {
  type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
} };
const source: ContextMessage[] = [{ role: 'system', content: 'Original Agent role and project rules' },
  { role: 'user', content: 'Inspect the file' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: tool.name, arguments: '{"path":"a.txt"}' }] },
  { role: 'tool', toolCallId: 'call-1', content: 'File evidence' },
  { role: 'assistant', content: 'The file has been inspected.' }];
const instruction: ContextMessage = { role: 'user', origin: 'framework', content: 'Summarize the preceding history.' };

async function fixture(t: test.TestContext, protocol: string): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordered-compaction-transport-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://provider.test/v1', models: ['model'],
    providerType: protocol === 'anthropic-messages' ? 'anthropic' : 'openai-compatible', transport: protocol,
  }] }));
  return dataDir;
}

function success(protocol: string): Response {
  return Response.json(protocol === 'anthropic-messages'
    ? { content: [{ type: 'text', text: 'Accepted handoff.' }], stop_reason: 'end_turn' }
    : { choices: [{ message: { content: 'Accepted handoff.' }, finish_reason: 'stop' }] });
}

for (const protocol of ['openai-chat-completions', 'anthropic-messages']) {
  test(`${protocol}: compaction keeps original history and tool definitions while disabling new tools`, async t => {
    const dataDir = await fixture(t, protocol), before = structuredClone(source);
    const requests: Array<Record<string, any>> = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      requests.push(JSON.parse(String(init?.body))); return success(protocol);
    });
    await callLLM({ dataDir, fullModelKey: 'fixture:model', messages: source, tools: [tool] });
    await callLLM({ dataDir, fullModelKey: 'fixture:model', messages: [...source, instruction],
      tools: [tool], purpose: 'compaction', historyToolTransport: 'native' });
    const [ordinary, compact] = requests;
    assert.deepEqual(compact.messages.slice(0, ordinary.messages.length), ordinary.messages);
    assert.deepEqual(compact.tools, ordinary.tools);
    if (protocol === 'anthropic-messages') {
      assert.equal(compact.system, ordinary.system);
      assert.equal(compact.system, source[0].content);
      assert.deepEqual(compact.tool_choice, { type: 'none' });
      assert.equal(compact.messages.at(-1).content[0].text, instruction.content);
    } else {
      assert.equal(ordinary.tool_choice, 'auto');
      assert.equal(compact.tool_choice, 'none');
      assert.equal(compact.messages[2].tool_calls[0].id, 'call-1');
      assert.equal(compact.messages[3].tool_call_id, 'call-1');
      assert.equal(compact.messages.at(-1).content, instruction.content);
    }
    assert.deepEqual(source, before);
  });

  test(`${protocol}: historical native tools do not require inventing current tool declarations`, async t => {
    const dataDir = await fixture(t, protocol);
    let request: Record<string, any> | undefined;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      request = JSON.parse(String(init?.body)); return success(protocol);
    });
    await callLLM({ dataDir, fullModelKey: 'fixture:model', messages: [...source, instruction],
      purpose: 'compaction', historyToolTransport: 'native' });
    assert.equal(request!.tools, undefined);
    assert.equal(request!.tool_choice, undefined);
    if (protocol === 'anthropic-messages') {
      assert.equal(request!.messages[1].content[0].type, 'tool_use');
      assert.equal(request!.messages[2].content[0].type, 'tool_result');
      assert.equal(request!.messages[2].content[0].tool_use_id, 'call-1');
    } else {
      assert.equal(request!.messages[2].tool_calls[0].id, 'call-1');
      assert.equal(request!.messages[3].role, 'tool');
      assert.equal(request!.messages[3].tool_call_id, 'call-1');
    }
  });

  test(`${protocol}: explicit text tool history stays readable in its original message order`, async t => {
    const dataDir = await fixture(t, protocol);
    let request: Record<string, any> | undefined;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      request = JSON.parse(String(init?.body)); return success(protocol);
    });
    await callLLM({ dataDir, fullModelKey: 'fixture:model', messages: [...source, instruction],
      purpose: 'compaction', historyToolTransport: 'text' });
    assert.equal(request!.tools, undefined);
    const messages = request!.messages;
    const rendered = JSON.stringify(messages);
    assert.match(rendered, /tool_call/); assert.match(rendered, /tool_result/);
    assert.match(rendered, /File evidence/);
    assert.equal(messages.some((message: Record<string, unknown>) => message.role === 'tool'), false);
  });

  for (const streaming of [false, true]) {
    test(`${protocol}: an unexpected tool response is rejected with failed usage (streaming: ${streaming})`, async t => {
      const dataDir = await fixture(t, protocol);
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        if (protocol === 'anthropic-messages') {
          const response = { content: [{ type: 'tool_use', id: 'unexpected', name: 'read_file', input: {} }],
            stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 5 } };
          if (!streaming) return Response.json(response);
          return new Response([
            'event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: {
              id: 'msg-1', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 50, output_tokens: 0 } } }),
            'event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: 0,
              content_block: response.content[0] }),
            'event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }),
            'event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' },
              usage: { output_tokens: 5 } }),
            'event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }),
          ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
        }
        const message = { tool_calls: [{ id: 'unexpected', type: 'function', function: { name: 'read_file', arguments: '{}' } }] };
        const usage = { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 };
        return streaming
          ? new Response('data: ' + JSON.stringify({ choices: [{ delta: message, finish_reason: 'tool_calls' }], usage })
            + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
          : Response.json({ choices: [{ message, finish_reason: 'tool_calls' }], usage });
      });
      const events: ModelRequestUsageEvent[] = [];
      await assert.rejects(observeModelRequests(event => events.push(event), () => callLLM({
        dataDir, fullModelKey: 'fixture:model', purpose: 'compaction',
        messages: [...source, instruction], historyToolTransport: 'native',
        ...(streaming ? { onChunk: () => {} } : {}),
      })), /压缩请求返回了工具调用/);
      assert.equal(requests, 1);
      assert.equal(events.at(-1)?.request.state, 'failed');
      assert.equal(events.at(-1)?.request.usage?.promptTokens, 50);
      assert.equal(events.at(-1)?.request.usage?.completionTokens, 5);
    });
  }
}
