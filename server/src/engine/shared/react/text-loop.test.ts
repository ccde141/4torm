import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { frameworkError } from '../framework-error.js';
import { parseTextToolResult } from '../text-tool-protocol.js';
import { runReActLoop } from './text-loop.js';
import { MAX_CONTINUATIONS } from './native-loop.js';

function reply(content: string) {
  return { content, finishReason: 'stop' as const };
}

test('text loop executes a JSON tool call and accepts a natural-language answer', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'Read the file.' }];
  const responses = [
    reply('{"type":"tool_call","name":"read_file","arguments":{"filePath":"a.txt"}}'),
    reply('The file contains hello.'),
  ];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

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
  assert.equal(messages.at(-3)?.role, 'assistant');
  assert.equal(messages.at(-3)?.content, '{"type":"tool_call","name":"read_file","arguments":{"filePath":"a.txt"}}');
  assert.deepEqual(messages.at(-1), { role: 'assistant', content: 'The file contains hello.' });
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

test('text exhausted continuation preserves readable body and completed side effects, then removes temporary frames', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'write then explain' }];
  const tokens: string[] = [];
  let requests = 0; let executions = 0;
  const result = await runReActLoop({ messages,
    llm: { call: async (_messages, _options, onChunk) => {
      requests++;
      const content = requests === 1 ? '{"type":"tool_call","name":"write","arguments":{}}' : `正文-${requests}`;
      onChunk?.(content);
      if (requests === 3) messages.push({ role: 'system', content: '运行中新增事实' });
      return { content, finishReason: requests === 1 ? 'stop' : 'length',
        usage: { promptTokens: requests, completionTokens: 1, totalTokens: requests + 1 } };
    } },
    tools: { call: async () => { executions++; return '原件已保存'; } },
    onEvent: event => { if (event.type === 'token') tokens.push(event.chunk); },
  });
  assert.equal(requests, MAX_CONTINUATIONS + 2);
  assert.equal(executions, 1);
  assert.equal(result.toolCalls[0]?.result, '原件已保存');
  assert.equal(result.termination.status, 'failed');
  if (result.termination.status === 'failed') assert.equal(result.termination.error.code, 'MODEL_OUTPUT_LIMIT');
  for (let index = 2; index <= requests; index++) assert.match(result.content, new RegExp(`正文-${index}`));
  assert.equal(tokens.join(''), result.content);
  assert.equal(result.usage?.promptTokens, requests);
  assert.ok(messages.some(message => message.content === '运行中新增事实'));
  assert.equal(messages.filter(message => message.role === 'assistant').length, 2);
  assert.ok(!messages.some(message => message.content.startsWith('[System: continuation]')));
});

for (const variant of ['complete', 'incomplete', 'early-type', 'early-fence'] as const) {
  test(`text exhausted continuation never executes or displays tool protocol (${variant})`, async () => {
    const messages: ContextMessage[] = [{ role: 'user', content: 'write' }];
    const tokens: string[] = [];
    let requests = 0; let executions = 0;
    const result = await runReActLoop({ messages,
      llm: { call: async (_messages, _options, onChunk) => {
        requests++;
        const prefix = variant === 'early-type' ? '{"type":"tool_ca' : variant === 'early-fence' ? '```tool_ca'
          : '{"type":"tool_call","name":"write","arguments":{';
        const content = requests === 1 ? prefix
          : requests === MAX_CONTINUATIONS + 1 && variant === 'complete' ? '}}' : ' ';
        onChunk?.(content);
        return { content, finishReason: 'length' };
      } },
      tools: { call: async () => { executions++; return '不得执行'; } },
      onEvent: event => { if (event.type === 'token') tokens.push(event.chunk); },
    });
    assert.equal(requests, MAX_CONTINUATIONS + 1);
    assert.equal(executions, 0);
    assert.equal(result.termination.status, 'failed');
    if (result.termination.status === 'failed') assert.equal(result.termination.error.code, 'MODEL_OUTPUT_LIMIT');
    assert.doesNotMatch(result.content, /tool_call|arguments/);
    assert.ok(result.rawContent.startsWith(variant === 'early-type' ? '{"type":"tool_ca'
      : variant === 'early-fence' ? '```tool_ca' : '{"type":"tool_call"'));
    assert.deepEqual(tokens, []);
    assert.deepEqual(messages, [{ role: 'user', content: 'write' }]);
  });
}

test('text output exhaustion still hands pending human input to steering before returning a limit failure', async () => {
  const pending: string[] = [];
  const messages: ContextMessage[] = [{ role: 'user', content: 'old task' }];
  let requests = 0;
  const result = await runReActLoop({ messages,
    steering: { hasPending: () => pending.length > 0, drain: () => pending.splice(0) },
    llm: { call: async () => {
      requests++;
      if (requests === MAX_CONTINUATIONS + 1) pending.push('new task');
      if (requests > MAX_CONTINUATIONS + 1) {
        assert.equal(messages.at(-1)?.content, 'new task');
        return reply('new answer');
      }
      return { content: requests === 1 ? '{"type":"tool_call","name":"write","arguments":' : ' ',
        finishReason: 'length' };
    } }, tools: { call: async () => { assert.fail('Old partial tool call must not run'); } },
  });
  assert.equal(requests, MAX_CONTINUATIONS + 2);
  assert.equal(result.content, 'new answer');
  assert.equal(result.termination.status, 'succeeded');
  assert.ok(!messages.some(message => message.content.startsWith('[System: continuation]')));
});

for (const abort of [false, true]) {
  test(`text retains completed body fragments when continuation fails (aborted: ${abort})`, async () => {
    const controller = new AbortController();
    const messages: ContextMessage[] = [{ role: 'user', content: 'long answer' }];
    const pending: string[] = [];
    let requests = 0;
    const result = await runReActLoop({ messages, signal: controller.signal,
      steering: { hasPending: () => pending.length > 0, drain: () => pending.splice(0) },
      llm: { call: async (_messages, _options, onChunk) => {
        requests++;
        if (requests <= 2) return { content: `正文-${requests}`, finishReason: 'length' };
        onChunk?.('本次已生成部分');
        pending.push('new input stays pending');
        if (abort) controller.abort();
        throw new Error('secret upstream interruption');
      } },
    });
    assert.equal(requests, 3);
    assert.equal(result.termination.status, abort ? 'aborted' : 'failed');
    assert.equal(result.content, '正文-1正文-2本次已生成部分');
    assert.equal(result.rawContent, result.content);
    assert.equal(messages.at(-1)?.content, result.content);
    assert.doesNotMatch(result.content, /secret upstream/);
    assert.deepEqual(pending, ['new input stays pending']);
    assert.ok(!messages.some(message => message.content.startsWith('[System: continuation]')));
  });
}

test('text continuation failure does not expose or execute a partial tool envelope', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'write' }];
  let requests = 0; let executions = 0;
  const result = await runReActLoop({ messages,
    llm: { call: async () => {
      if (++requests === 1) return { content: '{"type":"tool_call","name":"write","arguments":', finishReason: 'length' };
      throw new Error('upstream disconnected');
    } }, tools: { call: async () => { executions++; return 'must not execute'; } },
  });
  assert.equal(requests, 2);
  assert.equal(executions, 0);
  assert.equal(result.termination.status, 'failed');
  assert.doesNotMatch(result.content, /tool_call|arguments/);
  assert.equal(result.rawContent, '{"type":"tool_call","name":"write","arguments":');
  assert.deepEqual(messages, [{ role: 'user', content: 'write' }]);
});

test('text undecided long JSON is retained as raw evidence without claiming a delivered answer', async () => {
  let requests = 0;
  const result = await runReActLoop({ messages: [{ role: 'user', content: 'JSON report' }],
    llm: { call: async () => ({ content: ++requests === 1 ? '{"items":[' : '1,', finishReason: 'length' }) },
  });
  assert.equal(result.termination.status, 'failed');
  assert.doesNotMatch(result.content, /items/);
  assert.equal(result.rawContent, '{"items":[' + '1,'.repeat(MAX_CONTINUATIONS));
});
