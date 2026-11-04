import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoopNative, type LLMCaller } from './react/native-loop.js';
import { runReActLoop } from './react/text-loop.js';
import { TextToolStreamGate } from './text-tool-stream-gate.js';
import { unexecutedToolCall } from './tool-call-recovery.js';

const leaked = '准备修改：<tool_call>edit_file<arg_key>filePath</arg_key><arg_value>notes.txt</arg_value></tool_call>';
const definitions = [{ name: 'edit_file', description: 'edit', parameters: { type: 'object' } }];

for (const native of [true, false]) {
  test(`${native ? 'native' : 'text'} retries an XML leak without executing it, then executes only the corrected call`, async () => {
    let calls = 0, executed = 0;
    const tokens: string[] = [];
    const messages = [{ role: 'user' as const, content: '修改文档' }];
    const llm: LLMCaller = { call: async (_messages, _options, onChunk) => {
      calls++;
      if (calls === 1) {
        onChunk?.('准备修改：<tool_'); onChunk?.(leaked.slice('准备修改：<tool_'.length));
        return { content: leaked, finishReason: 'stop' };
      }
      if (calls === 2) return native ? { content: '', finishReason: 'tool_calls',
        toolCalls: [{ id: 'corrected', name: 'edit_file', arguments: '{"filePath":"notes.txt"}' }] }
        : { content: '{"type":"tool_call","name":"edit_file","arguments":{"filePath":"notes.txt"}}', finishReason: 'stop' };
      return { content: '已完成', finishReason: 'stop' };
    } };
    const common = { messages, llm, maxTurns: 6, allowedTools: ['edit_file'],
      tools: { call: async (_name: string, args: Record<string, unknown>) => {
        executed++; assert.equal(args.filePath, 'notes.txt'); return 'saved';
      } }, onEvent: (event: { type: string; chunk?: string }) => {
        if (event.type === 'token') tokens.push(event.chunk!);
      } };
    const result = await (native ? runReActLoopNative({ ...common, toolDefs: definitions }) : runReActLoop(common));
    assert.equal(result.termination.status, 'succeeded'); assert.equal(executed, 1); assert.equal(calls, 3);
    assert.doesNotMatch(tokens.join(''), /<tool_call>|<arg_key>/);
    assert.match(messages.map(message => message.content).join('\n'), /没有执行/);
  });

  test(`${native ? 'native' : 'text'} repeated XML leaks fail explicitly without a tool side effect`, async () => {
    let calls = 0, executed = 0;
    const common = { messages: [{ role: 'user' as const, content: '修改文档' }], maxTurns: 8,
      allowedTools: ['edit_file'], llm: { call: async () => { calls++; return { content: leaked, finishReason: 'stop' as const }; } },
      tools: { call: async () => { executed++; return 'unexpected'; } } };
    const result = await (native ? runReActLoopNative({ ...common, toolDefs: definitions }) : runReActLoop(common));
    assert.equal(result.termination.status, 'failed'); assert.equal(calls, 3); assert.equal(executed, 0);
    assert.match(result.content, /未执行/); assert.doesNotMatch(result.content, /<tool_call>/);
  });
}

test('quoted XML examples remain visible and cannot trigger recovery', () => {
  const answer = `使用说明：\n\x60\x60\x60xml\n${leaked}\n\x60\x60\x60`;
  assert.equal(unexecutedToolCall(answer, new Set(['edit_file'])), undefined);
  const chunks: string[] = [], gate = new TextToolStreamGate(chunk => chunks.push(chunk));
  for (const char of answer) gate.push(char);
  gate.finish(true); assert.equal(chunks.join(''), answer);
  assert.equal(unexecutedToolCall(leaked, new Set(['read_file'])), undefined);
});

test('human steering cannot reintroduce leaked XML through accumulated assistant text', async () => {
  let pending = false, modelCalls = 0;
  const result = await runReActLoopNative({ messages: [{ role: 'user', content: '修改文档' }], toolDefs: definitions,
    maxTurns: 4, steering: { hasPending: () => pending, drain: () => { pending = false; return ['先停止修改']; } },
    llm: { call: async () => {
      if (++modelCalls === 1) { pending = true; return { content: leaked, finishReason: 'stop' }; }
      return { content: '已停止修改', finishReason: 'stop' };
    } } });
  assert.equal(result.termination.status, 'succeeded');
  assert.match(result.content, /已停止修改/); assert.doesNotMatch(result.content, /<tool_call>|<arg_key>/);
});
