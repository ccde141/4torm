/** Tradewind adapter for the shared JSON text-tool loop. */

import type { ContextMessage, LLMOptions } from '../../shared/types.js';
import {
  type ReActStreamEvent,
  type ToolCallRecord,
} from '../../shared/react/native-loop.js';
import { runReActLoop as runSharedTextLoop } from '../../shared/react/text-loop.js';

export type { ToolCallRecord };

export interface LLMCaller {
  call(
    messages: ContextMessage[],
    options?: LLMOptions,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    onReasoning?: (chunk: string) => void,
  ): Promise<{
    content: string;
    finishReason: 'stop' | 'length' | 'tool_calls' | null;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>;
}

export interface ToolCaller {
  call(
    tool: string,
    args: Record<string, string>,
    onMeta?: (meta: unknown) => void,
  ): Promise<string>;
}

export interface ReActLoopParams {
  messages: ContextMessage[];
  llm: LLMCaller;
  tools?: ToolCaller;
  allowedTools?: readonly string[];
  maxTurns?: number;
  onEvent?: (event: ReActStreamEvent) => void;
  signal?: AbortSignal;
}

export interface ReActLoopResult {
  content: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  turns: number;
  lastPromptTokens?: number;
}

export async function runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
  const result = await runSharedTextLoop({
    ...params,
    llm: {
      call(messages, options, onChunk, signal, _tools, onReasoning) {
        return params.llm.call(messages, options, onChunk, signal, onReasoning);
      },
    },
  });

  return {
    content: result.content,
    rawContent: result.rawContent,
    toolCalls: result.toolCalls,
    turns: result.turns,
    lastPromptTokens: result.usage?.promptTokens,
  };
}
