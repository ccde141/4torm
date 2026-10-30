import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTextToolResult } from './text-tool-protocol.js';
import { runTextSubAgentLoop } from './text-sub-agent-loop.js';
import type { ContextMessage } from './types.js';

test('text SubAgent executes tools and only succeeds through done', async () => {
  const replies = [
    '{"type":"tool_call","name":"read_file","arguments":{"filePath":"a.txt"}}',
    '{"type":"tool_call","name":"done","arguments":{"summary":"found A"}}',
  ];
  const result = await runTextSubAgentLoop({
    messages: [], maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({ content: replies.shift() ?? '', finishReason: 'stop' }),
    callTool: async () => 'A',
  });
  assert.deepEqual(result, { status: 'success', summary: 'found A', rounds: 1 });
});

test('text SubAgent rejects natural-language completion', async () => {
  const result = await runTextSubAgentLoop({
    messages: [], maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({ content: 'I am finished', finishReason: 'stop' }),
    callTool: async () => 'unused',
  });
  assert.equal(result.status, 'error');
  assert.match(result.error ?? '', /done/);
});

test('text SubAgent rejects recursive delegation', async () => {
  const result = await runTextSubAgentLoop({
    messages: [], maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({
      content: '{"type":"tool_call","name":"delegate","arguments":{"task":"x"}}',
      finishReason: 'stop',
    }),
    callTool: async () => 'unused',
  });
  assert.equal(result.status, 'error');
  assert.match(result.error ?? '', /delegate/);
});

test('text SubAgent preserves a typed MCP failure and emits one result event', async () => {
  const messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> = [];
  const results: Array<{ result: string; ok: boolean }> = [];
  const replies = [
    '{"type":"tool_call","name":"mcp:test:inspect","arguments":{}}',
    '{"type":"tool_call","name":"done","arguments":{"summary":"reported failure"}}',
  ];
  await runTextSubAgentLoop({
    messages, maxRounds: 2, signal: new AbortController().signal,
    callModel: async () => ({ content: replies.shift() ?? '', finishReason: 'stop' }),
    callTool: async () => ({ result: 'permission denied', ok: false }),
    onToolResult: (_name, result, ok) => results.push({ result, ok }),
  });

  assert.deepEqual(results, [{ result: 'permission denied', ok: false }]);
  assert.deepEqual(parseTextToolResult(messages[1]?.content ?? ''), {
    name: 'mcp:test:inspect', content: 'permission denied', ok: false,
  });
});

test('text SubAgent completes a truncated tool envelope before executing it once', async () => {
  const messages: ContextMessage[] = [{ role: 'user', content: 'Verify TASK-42.' }];
  const calls: string[] = [];
  let requests = 0;
  const result = await runTextSubAgentLoop({ messages, maxRounds: 3, signal: new AbortController().signal,
    callModel: async () => {
      requests++;
      if (requests === 1) return { content: '{"type":"tool_call","name":"read_file","arguments":{"filePath":"a', finishReason: 'length' };
      if (requests === 2) {
        assert.match(messages.at(-1)!.content, /^\[System: continuation\]/);
        assert.equal(calls.length, 0, 'an unfinished envelope cannot invoke a tool');
        messages.push({ role: 'user', origin: 'framework', content: 'Independent runtime fact' });
        return { content: '.txt"}}', finishReason: 'stop' };
      }
      return { content: '{"type":"tool_call","name":"done","arguments":{"summary":"TASK-42 checked"}}', finishReason: 'stop' };
    }, callTool: async (name, args) => { calls.push(`${name}:${args.filePath}`); return 'evidence'; } });
  assert.equal(result.status, 'success');
  assert.equal(result.rounds, 1);
  assert.deepEqual(calls, ['read_file:a.txt']);
  assert.ok(messages.some(message => message.content === 'Independent runtime fact'));
  assert.ok(!messages.some(message => message.content.startsWith('[System: continuation]')));
  assert.equal(messages.filter(message => message.role === 'assistant' && message.content.includes('read_file')).length, 1);
});

for (const cancelled of [false, true]) {
  test(`text SubAgent ${cancelled ? 'cancellation' : 'failure'} preserves completed work and received continuation output`, async () => {
    const abort = new AbortController();
    const messages: ContextMessage[] = [];
    let requests = 0, tools = 0;
    const result = await runTextSubAgentLoop({ messages, maxRounds: 3, signal: abort.signal,
      callModel: async onPartial => {
        requests++;
        if (requests === 1) return { content: '{"type":"tool_call","name":"read_file","arguments":{}}', finishReason: 'stop' };
        if (requests === 2) return { content: '{"type":"tool_call","name":"done","arguments":{"summary":"FIRST-', finishReason: 'length' };
        onPartial?.('SECOND');
        if (cancelled) abort.abort(new Error('Fixture stop'));
        throw new Error('Fixture connection failure');
      }, callTool: async () => { tools++; return 'Verified result'; } });
    assert.equal(result.status, cancelled ? 'aborted' : 'error');
    assert.equal(result.rounds, 1);
    assert.equal(tools, 1);
    assert.ok(result.summary.includes('FIRST-SECOND'));
    assert.ok(messages.some(message => message.content.includes('Verified result')));
    assert.equal(messages.filter(message => message.content.includes('FIRST-SECOND')).length, 1);
    assert.ok(!messages.some(message => message.content.startsWith('[System: continuation]')));
  });
}

for (const tool of ['write_file', 'done']) {
  test(`text SubAgent cancellation at the model response boundary prevents ${tool}`, async () => {
    const abort = new AbortController();
    const messages: ContextMessage[] = [];
    const executed: string[] = [];
    let requests = 0;
    const final = JSON.stringify({ type: 'tool_call', name: tool,
      arguments: tool === 'done' ? { summary: 'Must not report success' } : { filePath: 'unused.txt', content: 'unused' } });
    const result = await runTextSubAgentLoop({ messages, maxRounds: 3, signal: abort.signal,
      callModel: async () => {
        if (++requests === 1) return { content: '{"type":"tool_call","name":"read_file","arguments":{}}', finishReason: 'stop' };
        abort.abort(new Error('Fixture boundary stop'));
        return { content: final, finishReason: 'stop' };
      }, callTool: async name => { executed.push(name); return 'Verified read'; } });
    assert.equal(result.status, 'aborted');
    assert.equal(result.rounds, 1);
    assert.deepEqual(executed, ['read_file']);
    assert.equal(messages.at(-1)?.content, final, 'received output remains a diagnostic without becoming an operation');
    assert.ok(result.summary.includes('未执行'));
  });
}
