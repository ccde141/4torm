import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
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
  assert.deepEqual(calls, [{ name: 'read_file', args: { filePath: 'a.txt' } }]);
  assert.equal(messages.at(-2)?.content, JSON.stringify({
    type: 'tool_result', name: 'read_file', ok: true, content: 'hello',
  }));
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

test('text loop throws malformed tool-call envelopes without retrying', async () => {
  let calls = 0;
  await assert.rejects(() => runReActLoop({
    messages: [{ role: 'user', content: 'Use ping.' }],
    llm: {
      call: async () => {
        calls++;
        return reply('{"type":"tool_call","name":"ping","arguments":');
      },
    },
  }), /not valid JSON/);
  assert.equal(calls, 1);
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
