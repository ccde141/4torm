import assert from 'node:assert/strict';
import test from 'node:test';
import { runReActLoopNative } from '../../shared/react/native-loop.js';
import { runReActLoop } from './tradewind-react-adapter.js';
import { buildEnvelopeToolDefs } from './virtual-tools.js';
import { EnvelopeDraft, execEnvelopeToolOutcome, isEnvelopeRound } from './envelope-draft.js';
import { resolveHandoffCompletion } from './handoff-completion.js';
import { buildConditionalHandoffPrompt } from './handoff-prompt.js';

const routes = [
  { edgeId: 'review-rework', targetNodeId: 'writer', label: '制作' },
  { edgeId: 'review-output', targetNodeId: 'output', label: '交付' },
];

test('native 完成工具与文本 JSON 完成工具走同一单目标封口，完成后不再执行额外工具', async () => {
  for (const native of [true, false]) {
    const draft = new EnvelopeDraft(routes);
    let calls = 0;
    let toolCalls = 0;
    const tools = { call: async (tool: string, args: Record<string, string>) => {
      toolCalls++;
      return execEnvelopeToolOutcome(draft, tool, args);
    } };
    const args = { targetNodeId: 'writer', note: '字号过小，请按原要求修订。' };
    const nativeResult = native ? await runReActLoopNative({
      messages: [], llm: { call: async () => { calls++; return { content: '', finishReason: 'tool_calls',
        toolCalls: [
          { id: 'complete', name: 'complete_task', arguments: JSON.stringify(args) },
          { id: 'bad-second', name: 'envelope_add', arguments: JSON.stringify({ text: '不能执行' }) },
        ] }; } }, tools, toolDefs: buildEnvelopeToolDefs(routes), completion: { tool: 'complete_task' },
    }) : await runReActLoop({ messages: [], llm: { call: async () => {
      calls++; return { content: JSON.stringify({ type: 'tool_call', name: 'complete_task', arguments: args }), finishReason: 'stop' };
    } }, tools, allowedTools: buildEnvelopeToolDefs(routes).map(tool => tool.name), completion: { tool: 'complete_task' } });
    const result = resolveHandoffCompletion(nativeResult, draft, true);
    assert.deepEqual(result.target, { targetNodeId: 'writer', edgeId: 'review-rework' });
    assert.match(result.content, /字号过小/);
    assert.equal(calls, 1);
    assert.equal(toolCalls, 1);
    assert.equal(execEnvelopeToolOutcome(draft, 'complete_task', { targetNodeId: 'output' }).ok, false);
  }
});

test('非法、缺失及多目标不能封口，正文或强制兜底不能误当成功交接', async () => {
  for (const args of [{ targetNodeId: 'missing' }, {}, { targetNodeId: 'writer', edgeId: 'review-output' },
    { targetNodeId: ['writer', 'output'] }]) {
    const draft = new EnvelopeDraft(routes);
    assert.equal(execEnvelopeToolOutcome(draft, 'complete_task', args as Record<string, string>).ok, false);
    assert.equal(draft.getSelectedTarget(), undefined);
  }
  const draft = new EnvelopeDraft(routes);
  const text = await runReActLoop({ messages: [], llm: { call: async () => ({ content: '我已完成', finishReason: 'stop' }) },
    tools: { call: async (tool, args) => execEnvelopeToolOutcome(draft, tool, args) },
    allowedTools: ['complete_task'], completion: { tool: 'complete_task' } });
  assert.throws(() => resolveHandoffCompletion(text, draft, true), /有效的单目标封口/);
  draft.complete('已有内容', { targetNodeId: 'output' });
  assert.throws(() => resolveHandoffCompletion({ autoOutcome: 'anomaly' as const,
    termination: { status: 'anomaly' } }, draft, true), /有效的单目标封口/);
});

test('human/contact 不持有信封工具权，旧 strict 文本模式保持原协议', () => {
  for (const native of [true, false]) {
    assert.equal(isEnvelopeRound('human', native, true), false);
    assert.equal(isEnvelopeRound('contact', native, true), false);
    assert.equal(isEnvelopeRound('envelope', native, true), true);
  }
  assert.equal(isEnvelopeRound('envelope', false), false);
  assert.equal(isEnvelopeRound('envelope', true), true);
  const textPrompt = buildConditionalHandoffPrompt(routes, false);
  assert.match(textPrompt, /review-rework/);
  assert.match(textPrompt, /"type":"tool_call"/);
  assert.match(textPrompt, /不能广播、分裂/);
});

test('text 信封轮中止不产生封口结果，模型真实失败保持失败', async () => {
  const abort = new AbortController(); abort.abort();
  const draft = new EnvelopeDraft(routes);
  const input = { messages: [], tools: { call: async (tool: string, args: Record<string, string>) => execEnvelopeToolOutcome(draft, tool, args) },
    allowedTools: ['complete_task'], completion: { tool: 'complete_task' } };
  const stopped = await runReActLoop({ ...input, signal: abort.signal,
    llm: { call: async () => { throw new Error('不应调用模型'); } } });
  assert.equal(stopped.termination.status, 'aborted');
  assert.equal(draft.getSelectedTarget(), undefined);
  const failed = await runReActLoop({ ...input, llm: { call: async () => { throw new Error('真实网络故障'); } } });
  assert.equal(failed.termination.status, 'failed');
  assert.equal(draft.getSelectedTarget(), undefined);
});
