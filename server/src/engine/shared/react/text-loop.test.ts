import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { frameworkError } from '../framework-error.js';
import { parseTextToolResult } from '../text-tool-protocol.js';
import { runReActLoop } from './text-loop.js';

function reply(content: string) {
  return { content, finishReason: 'stop' as const };
}

test('text loop executes a JSON tool call and accepts a natural-language answer', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'Read the file.' }];
  const responses = [
    reply('{"type":"tool_call","name":"read_file","arguments":{"filePath":"a.txt"}}'),
    reply('The file contains hello.'),
  ];
  const calls: Array<{ name: string; args: Record<string, string> }> = [];

  const result = await runReActLoop({
    messages,
    llm: { call: async () => responses.shift()! },
    tools: {
      call: async (name, args) => {
        calls.push({ name, args });
        return 'hello';
      },
    },
  });

  assert.equal(result.content, 'The file contains hello.');
  assert.deepEqual(result.termination, { status: 'succeeded' });
  assert.deepEqual(calls, [{ name: 'read_file', args: { filePath: 'a.txt' } }]);
  assert.equal(messages.at(-2)?.content, JSON.stringify({
    type: 'tool_result', name: 'read_file', ok: true, content: 'hello',
  }));
});

test('text loop writes explicit tool failure status into tool_result without parsing error words', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'Read.' }];
  const responses = [
    reply('{"type":"tool_call","name":"read_file","arguments":{}}'),
    reply('Done.'),
  ];
  const resultEvents: Array<{ ok?: boolean }> = [];
  const result = await runReActLoop({
    messages,
    llm: { call: async () => responses.shift()! },
    tools: { call: async () => ({ result: '读取失败', ok: false }) },
    onEvent: event => { if (event.type === 'tool-result') resultEvents.push(event as { ok?: boolean }); },
  });

  assert.equal(result.content, 'Done.');
  assert.deepEqual(parseTextToolResult(messages.at(-2)?.content ?? ''), {
    name: 'read_file', content: '读取失败', ok: false,
  });
  assert.equal(resultEvents.length, 1);
  assert.equal(resultEvents[0].ok, false);
});

test('text loop treats a legacy string result as success even when its content starts with Error', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'Read.' }];
  const responses = [
    reply('{"type":"tool_call","name":"read_file","arguments":{}}'),
    reply('Done.'),
  ];
  await runReActLoop({
    messages,
    llm: { call: async () => responses.shift()! },
    tools: { call: async () => 'Error: literal file contents' },
  });

  assert.equal(parseTextToolResult(messages.at(-2)?.content ?? '')?.ok, true);
});

test('text loop hides tool-call envelope tokens but streams the final answer', async () => {
  const responses = [
    reply('{"type":"tool_call","name":"ping","arguments":{}}'),
    reply('pong'),
  ];
  const tokens: string[] = [];
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'ping' }],
    llm: {
      call: async (_messages, _options, onChunk) => {
        const response = responses.shift()!;
        for (const chunk of response.content.match(/.{1,5}/g) ?? []) onChunk?.(chunk);
        return response;
      },
    },
    tools: { call: async () => 'ok' },
    onEvent: event => { if (event.type === 'token') tokens.push(event.chunk); },
  });

  assert.equal(result.content, 'pong');
  assert.equal(tokens.join(''), 'pong');
});

test('text loop releases an ordinary JSON answer after classification', async () => {
  const content = '{"status":"ok"}';
  const tokens: string[] = [];
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'status' }],
    llm: {
      call: async (_messages, _options, onChunk) => {
        onChunk?.('{"status":');
        onChunk?.('"ok"}');
        return reply(content);
      },
    },
    onEvent: event => { if (event.type === 'token') tokens.push(event.chunk); },
  });

  assert.equal(result.content, content);
  assert.equal(tokens.join(''), content);
});

test('text loop treats an ordinary answer as complete without nudging', async () => {
  let calls = 0;
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'Hello' }],
    llm: { call: async () => { calls++; return reply('Hello back.'); } },
  });

  assert.equal(result.content, 'Hello back.');
  assert.equal(calls, 1);
});

test('text loop reports malformed tool-call envelopes as a protocol failure without retrying', async () => {
  let calls = 0;
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'Use ping.' }],
    llm: {
      call: async () => {
        calls++;
        return reply('{"type":"tool_call","name":"ping","arguments":');
      },
    },
  });
  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') {
    assert.equal(result.termination.error.code, 'MODEL_PROTOCOL_ERROR');
  }
  assert.equal(calls, 1);
});

test('text loop reports a provider failure as a failed terminal state', async () => {
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'Hello' }],
    llm: { call: async () => { throw new Error('secret upstream body'); } },
  });

  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') {
    assert.equal(result.termination.error.code, 'MODEL_REQUEST_FAILED');
    assert.equal(result.termination.error.message, '模型请求失败');
  }
  assert.doesNotMatch(result.content, /secret upstream body/);
});

test('text loop preserves a safe typed provider failure for the UI', async () => {
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'Hello' }],
    llm: { call: async () => { throw frameworkError({
      code: 'MODEL_REQUEST_REJECTED', kind: 'validation',
      message: '模型服务拒绝请求（HTTP 400）：unsupported option',
      source: 'llm-bridge', retryable: false,
    }); } },
  });
  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') {
    assert.equal(result.termination.error.code, 'MODEL_REQUEST_REJECTED');
    assert.match(result.content, /unsupported option/);
  }
});

test('text loop refuses a tool that was not offered this turn', async () => {
  const responses = [
    reply('{"type":"tool_call","name":"write_file","arguments":{"filePath":"x","content":"x"}}'),
    reply('I cannot use that tool.'),
  ];
  let executions = 0;
  const result = await runReActLoop({
    messages: [{ role: 'user', content: 'write' }],
    llm: { call: async () => responses.shift()! },
    tools: { call: async () => { executions++; return 'unexpected'; } },
    allowedTools: ['read_file'],
  });

  assert.equal(executions, 0);
  assert.equal(result.content, 'I cannot use that tool.');
  assert.match(String(result.toolCalls[0]?.result), /not authorized/);
});
