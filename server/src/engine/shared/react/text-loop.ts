/** Text-compatible ReAct loop using framework-owned JSON envelopes. */

import type { TokenUsage } from '../llm-bridge';
import type { ToolImageRef } from '../types.js';
import {
  formatTextToolResult,
  parseTextToolResponse,
  type TextToolResponse,
} from '../text-tool-protocol.js';
import { TextToolStreamGate } from '../text-tool-stream-gate.js';
import { applyPendingInput, skipTextTool } from './steering.js';
import {
  HEARTBEAT_INTERVAL_MS,
  LLM_TIMEOUT_MS,
  MAX_CONTINUATIONS,
  MAX_TURNS,
  SuspendSignal,
  normalizeToolCallResult,
  type ReActLoopParams,
  type ReActLoopResult,
  type ToolCallRecord,
} from './native-loop.js';
import {
  abortedTermination,
  anomalyTermination,
  failedTermination,
  modelOutputLimitError,
  reactError,
  reactErrorData,
  succeededTermination,
  waitingTermination,
} from './outcome.js';

const CONTINUATION_HINT = [
  '[System: continuation]',
  'Continue exactly where the previous response was truncated.',
  'Do not repeat existing content or restart the answer.',
].join(' ');

const TOOL_RESULT_LIMIT = 6_000;
const TOOL_RESULT_HEAD = 2_500;
const TOOL_RESULT_TAIL = 2_500;

interface ContinuedResponse {
  content: string;
  truncated: boolean;
  failure?: { error: unknown };
}

function readablePartialOutput(content: string, parsed: TextToolResponse): string {
  if (parsed.kind !== 'final' || !content.trim()) return '';
  let visible = false;
  const gate = new TextToolStreamGate(() => { visible = true; });
  gate.push(content);
  if (visible) return content;
  // The gate holds ambiguous JSON/tool prefixes. Only a complete ordinary JSON
  // answer may be released without first recognizing natural-language output.
  const json = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(content.trim())?.[1] ?? content;
  try { JSON.parse(json); return content; } catch { return ''; }
}

function trimToolResult(result: string): string {
  if (result.length <= TOOL_RESULT_LIMIT) return result;
  const omitted = result.length - TOOL_RESULT_HEAD - TOOL_RESULT_TAIL;
  return `${result.slice(0, TOOL_RESULT_HEAD)}\n\n[${omitted} characters omitted]\n\n${result.slice(-TOOL_RESULT_TAIL)}`;
}

async function callModel(
  params: ReActLoopParams,
  onUsage: (usage: TokenUsage | undefined) => void,
  tokenGate: TextToolStreamGate,
  onPartial?: (chunk: string) => void,
) {
  const { llm, messages, onEvent, signal } = params;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let received = false;
  const heartbeat = onEvent ? setInterval(() => {
    if (!received) onEvent({ type: 'heartbeat', phase: 'llm-waiting', elapsed: Date.now() - startedAt });
  }, HEARTBEAT_INTERVAL_MS) : undefined;

  try {
    const result = await llm.call(
      messages,
      undefined,
      chunk => { received = true; onPartial?.(chunk); tokenGate.push(chunk); },
      controller.signal,
      undefined,
      chunk => { received = true; onEvent?.({ type: 'reasoning', chunk }); },
    );
    onUsage(result.usage);
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function completeTruncatedResponse(
  params: ReActLoopParams,
  initial: string,
  onUsage: (usage: TokenUsage | undefined) => void,
  tokenGate: TextToolStreamGate,
): Promise<ContinuedResponse> {
  let content = initial;
  for (let count = 0; count < MAX_CONTINUATIONS; count++) {
    if (params.signal?.aborted) return { content, truncated: true, failure: { error: params.signal.reason } };
    if (params.steering?.hasPending()) return { content, truncated: true };
    const answer = { role: 'assistant' as const, content };
    const hint = { role: 'user' as const, content: CONTINUATION_HINT };
    params.messages.push(answer, hint);
    let generated = '';
    try {
      const result = await callModel(params, onUsage, tokenGate, chunk => { generated += chunk; });
      content += result.content;
      if (result.finishReason !== 'length') return { content, truncated: false };
    } catch (error) {
      return { content: content + generated, truncated: true, failure: { error } };
    } finally {
      // Owner commits can append runtime facts after this temporary pair while the request awaits.
      for (const temporary of [answer, hint]) {
        const index = params.messages.indexOf(temporary);
        if (index >= 0) params.messages.splice(index, 1);
      }
    }
  }
  return { content, truncated: true };
}

async function executeTool(
  params: ReActLoopParams,
  call: { name: string; arguments: Record<string, unknown> },
): Promise<{ result?: string; ok?: boolean; meta?: unknown; toolImages?: ToolImageRef[]; suspended?: ReActLoopResult['suspended'] }> {
  if (!params.tools) throw new Error(`Text tool call cannot run because tools are disabled: ${call.name}`);
  if (params.allowedTools && !params.allowedTools.includes(call.name)) {
    const result = `Error: tool is not authorized for this turn: ${call.name}`;
    params.onEvent?.({ type: 'tool-call', tool: call.name, args: call.arguments });
    params.onEvent?.({ type: 'tool-result', tool: call.name, result, ok: false });
    return { result, ok: false };
  }
  const args = call.arguments;
  params.onEvent?.({ type: 'tool-call', tool: call.name, args });
  const startedAt = Date.now();
  const heartbeat = params.onEvent ? setInterval(() => {
    params.onEvent?.({ type: 'heartbeat', phase: 'tool-exec', elapsed: Date.now() - startedAt });
  }, HEARTBEAT_INTERVAL_MS) : undefined;

  try {
    let callbackMeta: unknown;
    const output = normalizeToolCallResult(await params.tools.call(
      call.name, args, value => { callbackMeta = value; },
    ));
    const meta = output.meta === undefined ? callbackMeta : output.meta;
    params.onEvent?.({ type: 'tool-result', tool: call.name, result: output.result, ok: output.ok, meta,
      ...(output.toolImages?.length ? { toolImages: output.toolImages } : {}) });
    return { result: output.result, ok: output.ok, meta, toolImages: output.toolImages };
  } catch (error) {
    if (error instanceof SuspendSignal) {
      return { suspended: { question: error.question, options: error.options } };
    }
    const result = `Error: ${(error as Error).message}`;
    params.onEvent?.({ type: 'tool-result', tool: call.name, result, ok: false });
    return { result, ok: false };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

export async function runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
  const toolCalls: ToolCallRecord[] = [];
  const maxTurns = params.maxTurns ?? MAX_TURNS;
  let usage: TokenUsage | undefined;
  const recordUsage = (next: TokenUsage | undefined) => {
    usage = next;
    params.onEvent?.({ type: 'usage', usage: next ?? null });
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (params.signal?.aborted) {
      return { content: '[Interrupted]', rawContent: '', toolCalls, turns: turn, usage, termination: abortedTermination() };
    }
    applyPendingInput(params);
    const tokenGate = new TextToolStreamGate(chunk => params.onEvent?.({ type: 'token', chunk }));
    let response: Awaited<ReturnType<typeof callModel>>;
    let reply: string;
    let truncated: boolean;
    let continuationFailure: ContinuedResponse['failure'];
    let streamedContent = '';
    try {
      response = await callModel(params, recordUsage, tokenGate, chunk => { streamedContent += chunk; });
      const completed: ContinuedResponse = response.finishReason === 'length'
        ? await completeTruncatedResponse(params, response.content, recordUsage, tokenGate)
        : { content: response.content, truncated: false };
      reply = completed.content;
      truncated = completed.truncated;
      continuationFailure = completed.failure;
    } catch (error) {
      recordUsage(undefined);
      const partial = readablePartialOutput(streamedContent, parseTextToolResponse(streamedContent));
      tokenGate.finish(!!partial);
      if (partial) params.messages.push({ role: 'assistant', content: partial });
      if (params.signal?.aborted) {
        return { content: partial || '[Interrupted]', rawContent: streamedContent,
          toolCalls, turns: turn, usage, termination: abortedTermination() };
      }
      const failure = reactError(error, reactErrorData(
        'MODEL_REQUEST_FAILED', 'provider', '模型请求失败', 'react.text.model',
      ));
      params.onEvent?.({ type: 'error', message: failure.message });
      return {
        content: partial || `[错误] ${failure.message}`,
        rawContent: streamedContent,
        toolCalls,
        turns: turn,
        usage,
        termination: failedTermination(failure),
      };
    }
    const parsed = parseTextToolResponse(reply);
    const partial = truncated || continuationFailure || params.signal?.aborted
      ? readablePartialOutput(reply, parsed) : '';
    if (continuationFailure || params.signal?.aborted) {
      recordUsage(undefined);
      tokenGate.finish(!!partial);
      if (partial) params.messages.push({ role: 'assistant', content: partial });
      if (params.signal?.aborted) return { content: partial || '[Interrupted]', rawContent: reply,
        toolCalls, turns: turn + 1, usage, termination: abortedTermination() };
      const failure = reactError(continuationFailure?.error, reactErrorData(
        'MODEL_REQUEST_FAILED', 'provider', '模型请求失败', 'react.text.model',
      ));
      params.onEvent?.({ type: 'error', message: failure.message });
      return { content: partial || `[错误] ${failure.message}`, rawContent: reply,
        toolCalls, turns: turn + 1, usage, termination: failedTermination(failure) };
    }
    // Limited protocol text is diagnostic material, never a delivered answer or executable call.
    if (!truncated || partial || params.steering?.hasPending()) {
      params.messages.push({ role: 'assistant', content: reply });
    }
    if (params.steering?.hasPending()) {
      tokenGate.finish(truncated ? !!partial : parsed.kind === 'final');
      if (parsed.kind === 'tool-call') skipTextTool(params, parsed.name, toolCalls);
      continue;
    }
    if (truncated) {
      tokenGate.finish(!!partial);
      const failure = modelOutputLimitError('react.text.output');
      params.onEvent?.({ type: 'error', message: failure.message });
      return { content: partial || `[错误] ${failure.message}`, rawContent: reply,
        toolCalls, turns: turn + 1, usage, termination: failedTermination(failure) };
    }
    if (parsed.kind === 'invalid') {
      tokenGate.finish(false);
      const failure = reactErrorData(
        'MODEL_PROTOCOL_ERROR', 'protocol', '模型返回了无效的工具调用格式', 'react.text.protocol',
      );
      params.onEvent?.({ type: 'error', message: failure.message });
      return {
        content: `[错误] ${failure.message}`,
        rawContent: reply,
        toolCalls,
        turns: turn + 1,
        usage,
        termination: failedTermination(failure),
      };
    }
    if (parsed.kind === 'final') {
      tokenGate.finish(true);
      if (params.beforeFinish) {
        const notices = await params.beforeFinish();
        if (params.signal?.aborted) return { content: '[Interrupted]', rawContent: '', toolCalls,
          turns: turn + 1, usage, termination: abortedTermination() };
        if (notices.length || params.steering?.hasPending()) {
          params.messages.push(...notices.map(content => ({ role: 'user' as const, content })));
          continue;
        }
      }
      return { content: parsed.content, rawContent: reply, toolCalls, turns: turn + 1, usage, termination: succeededTermination() };
    }
    tokenGate.finish(false);

    const execution = await executeTool(params, parsed);
    if (execution.suspended) {
      return {
        content: '', rawContent: reply, toolCalls, turns: turn + 1, usage,
        suspended: execution.suspended, termination: waitingTermination(),
      };
    }
    const result = execution.result ?? '';
    toolCalls.push({
      tool: parsed.name,
      args: parsed.arguments,
      result,
      meta: execution.meta,
      ...(execution.toolImages?.length ? { toolImages: execution.toolImages } : {}),
    });
    params.messages.push({
      role: 'user',
      content: formatTextToolResult(parsed.name, trimToolResult(result), execution.ok ?? true),
      ...(execution.toolImages?.length ? { toolImages: execution.toolImages } : {}),
    });
  }

  const failure = reactErrorData(
    'REACT_TURN_LIMIT', 'protocol', `工具循环达到 ${maxTurns} 轮上限`, 'react.text.loop',
  );
  params.onEvent?.({ type: 'error', message: failure.message });
  return {
    content: `[错误] ${failure.message}`,
    rawContent: '',
    toolCalls,
    turns: maxTurns,
    usage,
    termination: anomalyTermination(failure),
  };
}
