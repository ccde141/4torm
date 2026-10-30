import type { ContextMessage } from './types.js';
import type { ToolArguments } from './tool-arguments.js';
import type { SubAgentResult } from './sub-agent-types.js';
import type { ToolCallOutcome } from './react/native-loop.js';
import { formatTextToolResult, parseTextToolResponse } from './text-tool-protocol.js';

interface ModelResult {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | null;
}

export interface TextSubAgentLoopParams {
  messages: ContextMessage[];
  maxRounds: number;
  signal: AbortSignal;
  callModel: (onPartial?: (chunk: string) => void) => Promise<ModelResult>;
  callTool: (name: string, args: ToolArguments) => Promise<string | ToolCallOutcome>;
  onToolCall?: (name: string, args: ToolArguments) => void;
  onToolResult?: (name: string, result: string, ok: boolean, toolImages?: import('./types.js').ToolImageRef[]) => void;
}

function failure(message: string, rounds: number): SubAgentResult {
  return { status: 'error', summary: 'SubAgent 协议错误', rounds, error: message };
}

const CONTINUATION_HINT = '[System: continuation] Continue exactly where the previous response was truncated. '
  + 'Do not repeat existing content or restart the answer.';

/** An incomplete tool envelope is model output only; it cannot reach the executor. */
async function completeResponse(params: TextSubAgentLoopParams): Promise<{ content: string; error?: unknown }> {
  let content = '';
  for (;;) {
    if (params.signal.aborted) return { content, error: params.signal.reason ?? new Error('SubAgent 被外部中止') };
    const temporary: ContextMessage[] = content ? [{ role: 'assistant', content },
      { role: 'user', origin: 'framework', content: CONTINUATION_HINT }] : [];
    params.messages.push(...temporary);
    let received = '';
    try {
      const response = await params.callModel(chunk => { received += chunk; });
      content += response.content;
      if (params.signal.aborted) return { content, error: params.signal.reason ?? new Error('SubAgent 被外部中止') };
      if (response.finishReason !== 'length') return { content };
      if (!response.content) return { content, error: new Error('SubAgent response was truncated without output to continue.') };
    } catch (error) {
      return { content: content + received, error };
    } finally {
      for (const message of temporary) {
        const index = params.messages.indexOf(message);
        if (index >= 0) params.messages.splice(index, 1);
      }
    }
  }
}

function interrupted(params: TextSubAgentLoopParams, content: string, cause: unknown, rounds: number): SubAgentResult {
  if (content) params.messages.push({ role: 'assistant', content });
  const status = params.signal.aborted ? 'aborted' : 'error';
  const summary = `SubAgent 执行中断，已完成 ${rounds} 次工具调用。`
    + (content ? `\n未完成的模型输出（未执行）：\n${content}` : '');
  return { status, summary, rounds,
    ...(status === 'error' ? { error: cause instanceof Error ? cause.message : String(cause) } : {}) };
}

export async function runTextSubAgentLoop(
  params: TextSubAgentLoopParams,
): Promise<SubAgentResult> {
  let rounds = 0;
  while (rounds < params.maxRounds) {
    if (params.signal.aborted) {
      return { status: 'aborted', summary: 'SubAgent 被外部中止', rounds };
    }
    const response = await completeResponse(params);
    if ('error' in response) return interrupted(params, response.content, response.error, rounds);
    if (params.signal.aborted) return interrupted(params, response.content, params.signal.reason, rounds);
    params.messages.push({ role: 'assistant', content: response.content });
    const parsed = parseTextToolResponse(response.content);
    if (parsed.kind === 'invalid') return failure(parsed.error, rounds);
    if (parsed.kind === 'final') {
      return failure('SubAgent must call done instead of returning natural language.', rounds);
    }
    const args = parsed.arguments;
    if (parsed.name === 'done') {
      const summary = args.summary;
      if (typeof summary !== 'string' || !summary.trim()) {
        return failure('done requires a non-empty summary.', rounds);
      }
      return { status: 'success', summary, rounds };
    }
    if (parsed.name === 'delegate') {
      return failure('SubAgent cannot call delegate recursively.', rounds);
    }
    params.onToolCall?.(parsed.name, args);
    try {
      const value = await params.callTool(parsed.name, args);
      const outcome = typeof value === 'string' ? { result: value, ok: true } : value;
      params.onToolResult?.(parsed.name, outcome.result, outcome.ok, outcome.toolImages);
      params.messages.push({
        role: 'user', content: formatTextToolResult(parsed.name, outcome.result, outcome.ok),
        ...(outcome.toolImages?.length ? { toolImages: outcome.toolImages } : {}),
      });
    } catch (cause) {
      const result = (cause as Error).message;
      params.onToolResult?.(parsed.name, result, false);
      params.messages.push({ role: 'user', content: formatTextToolResult(parsed.name, result, false) });
    }
    rounds++;
  }
  return { status: 'timeout', summary: 'SubAgent 未能在规定轮次内完成', rounds };
}
