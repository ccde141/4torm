/** Text-compatible ReAct loop using framework-owned JSON envelopes. */

import type { TokenUsage } from '../llm-bridge';
import {
  formatTextToolResult,
  parseTextToolResponse,
} from '../text-tool-protocol.js';
import { TextToolStreamGate } from '../text-tool-stream-gate.js';
import {
  HEARTBEAT_INTERVAL_MS,
  LLM_TIMEOUT_MS,
  MAX_CONTINUATIONS,
  MAX_TURNS,
  SuspendSignal,
  type ReActLoopParams,
  type ReActLoopResult,
  type ToolCallRecord,
} from './native-loop.js';

const CONTINUATION_HINT = [
  '[System: continuation]',
  'Continue exactly where the previous response was truncated.',
  'Do not repeat existing content or restart the answer.',
].join(' ');

const TOOL_RESULT_LIMIT = 6_000;
const TOOL_RESULT_HEAD = 2_500;
const TOOL_RESULT_TAIL = 2_500;

function trimToolResult(result: string): string {
  if (result.length <= TOOL_RESULT_LIMIT) return result;
  const omitted = result.length - TOOL_RESULT_HEAD - TOOL_RESULT_TAIL;
  return `${result.slice(0, TOOL_RESULT_HEAD)}\n\n[${omitted} characters omitted]\n\n${result.slice(-TOOL_RESULT_TAIL)}`;
}

function asToolArgs(value: Record<string, unknown>): Record<string, string> {
  return value as Record<string, string>;
}

async function callModel(
  params: ReActLoopParams,
  onUsage: (usage: TokenUsage | undefined) => void,
  tokenGate: TextToolStreamGate,
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
      chunk => { received = true; tokenGate.push(chunk); },
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
): Promise<string> {
  let content = initial;
  for (let count = 0; count < MAX_CONTINUATIONS; count++) {
    params.messages.push({ role: 'assistant', content });
    params.messages.push({ role: 'user', content: CONTINUATION_HINT });
    const result = await callModel(params, onUsage, tokenGate);
    params.messages.pop();
    params.messages.pop();
    content += result.content;
    if (result.finishReason !== 'length') return content;
  }
  throw new Error(`LLM response remained truncated after ${MAX_CONTINUATIONS} continuations.`);
}

async function executeTool(
  params: ReActLoopParams,
  call: { name: string; arguments: Record<string, unknown> },
): Promise<{ result?: string; meta?: unknown; suspended?: ReActLoopResult['suspended'] }> {
  if (!params.tools) throw new Error(`Text tool call cannot run because tools are disabled: ${call.name}`);
  if (params.allowedTools && !params.allowedTools.includes(call.name)) {
    const result = `Error: tool is not authorized for this turn: ${call.name}`;
    params.onEvent?.({ type: 'tool-call', tool: call.name, args: asToolArgs(call.arguments) });
    params.onEvent?.({ type: 'tool-result', tool: call.name, result });
    return { result };
  }
  const args = asToolArgs(call.arguments);
  params.onEvent?.({ type: 'tool-call', tool: call.name, args });
  const startedAt = Date.now();
  const heartbeat = params.onEvent ? setInterval(() => {
    params.onEvent?.({ type: 'heartbeat', phase: 'tool-exec', elapsed: Date.now() - startedAt });
  }, HEARTBEAT_INTERVAL_MS) : undefined;

  try {
    let meta: unknown;
    const result = await params.tools.call(call.name, args, value => { meta = value; });
    params.onEvent?.({ type: 'tool-result', tool: call.name, result, meta });
    return { result, meta };
  } catch (error) {
    if (error instanceof SuspendSignal) {
      return { suspended: { question: error.question, options: error.options } };
    }
    const result = `Error: ${(error as Error).message}`;
    params.onEvent?.({ type: 'tool-result', tool: call.name, result });
    return { result };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

export async function runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
  const toolCalls: ToolCallRecord[] = [];
  const maxTurns = params.maxTurns ?? MAX_TURNS;
  let usage: TokenUsage | undefined;
  const recordUsage = (next: TokenUsage | undefined) => { if (next) usage = next; };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (params.signal?.aborted) {
      return { content: '[Interrupted]', rawContent: '', toolCalls, turns: turn, usage };
    }
    const tokenGate = new TextToolStreamGate(chunk => params.onEvent?.({ type: 'token', chunk }));
    const response = await callModel(params, recordUsage, tokenGate);
    const reply = response.finishReason === 'length'
      ? await completeTruncatedResponse(params, response.content, recordUsage, tokenGate)
      : response.content;
    params.messages.push({ role: 'assistant', content: reply });

    const parsed = parseTextToolResponse(reply);
    if (parsed.kind === 'invalid') {
      tokenGate.finish(false);
      throw new Error(`Invalid text tool call: ${parsed.error}`);
    }
    if (parsed.kind === 'final') {
      tokenGate.finish(true);
      return { content: parsed.content, rawContent: reply, toolCalls, turns: turn + 1, usage };
    }
    tokenGate.finish(false);

    const execution = await executeTool(params, parsed);
    if (execution.suspended) {
      return { content: '', rawContent: reply, toolCalls, turns: turn + 1, usage, suspended: execution.suspended };
    }
    const result = execution.result ?? '';
    toolCalls.push({
      tool: parsed.name,
      args: asToolArgs(parsed.arguments),
      result,
      meta: execution.meta,
    });
    params.messages.push({
      role: 'user',
      content: formatTextToolResult(parsed.name, trimToolResult(result), !result.startsWith('Error: ')),
    });
  }

  throw new Error(`Text tool loop exceeded ${maxTurns} turns.`);
}
