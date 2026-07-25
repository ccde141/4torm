import type { ContextMessage } from './types.js';
import type { SubAgentResult } from './sub-agent-types.js';
import { formatTextToolResult, parseTextToolResponse } from './text-tool-protocol.js';

interface ModelResult {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | null;
}

export interface TextSubAgentLoopParams {
  messages: ContextMessage[];
  maxRounds: number;
  signal: AbortSignal;
  callModel: () => Promise<ModelResult>;
  callTool: (name: string, args: Record<string, string>) => Promise<string>;
  onToolCall?: (name: string, args: Record<string, string>) => void;
  onToolResult?: (name: string, result: string, ok: boolean) => void;
}

function failure(message: string, rounds: number): SubAgentResult {
  return { status: 'error', summary: 'SubAgent 协议错误', rounds, error: message };
}

export async function runTextSubAgentLoop(
  params: TextSubAgentLoopParams,
): Promise<SubAgentResult> {
  let rounds = 0;
  while (rounds < params.maxRounds) {
    if (params.signal.aborted) {
      return { status: 'aborted', summary: 'SubAgent 被外部中止', rounds };
    }
    const response = await params.callModel();
    if (response.finishReason === 'length') {
      return failure('SubAgent response was truncated.', rounds);
    }
    params.messages.push({ role: 'assistant', content: response.content });
    const parsed = parseTextToolResponse(response.content);
    if (parsed.kind === 'invalid') return failure(parsed.error, rounds);
    if (parsed.kind === 'final') {
      return failure('SubAgent must call done instead of returning natural language.', rounds);
    }
    const args = parsed.arguments as Record<string, string>;
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
      const result = await params.callTool(parsed.name, args);
      params.onToolResult?.(parsed.name, result, true);
      params.messages.push({ role: 'user', content: formatTextToolResult(parsed.name, result, true) });
    } catch (cause) {
      const result = (cause as Error).message;
      params.onToolResult?.(parsed.name, result, false);
      params.messages.push({ role: 'user', content: formatTextToolResult(parsed.name, result, false) });
    }
    rounds++;
  }
  return { status: 'timeout', summary: 'SubAgent 未能在规定轮次内完成', rounds };
}
