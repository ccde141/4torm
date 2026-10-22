/** Tradewind adapter for the shared JSON text-tool loop. */

import type { ContextMessage, LLMOptions } from '../../shared/types.js';
import {
  type ReActStreamEvent,
  type ToolCallRecord,
  type ToolCallOutcome,
} from '../../shared/react/native-loop.js';
import { runReActLoop as runSharedTextLoop } from '../../shared/react/text-loop.js';
import type { ReActTermination } from '../../shared/react/outcome.js';
import type { LLMCaller as SharedLLMCaller } from '../../shared/react/native-loop.js';
import { runTextCompletion } from './text-completion.js';

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
    args: Record<string, unknown>,
    onMeta?: (meta: unknown) => void,
  ): Promise<string | ToolCallOutcome>;
}

export interface ReActLoopParams {
  messages: ContextMessage[];
  llm: LLMCaller;
  tools?: ToolCaller;
  allowedTools?: readonly string[];
  maxTurns?: number;
  onEvent?: (event: ReActStreamEvent) => void;
  signal?: AbortSignal;
  llmTransform?: (llm: SharedLLMCaller) => SharedLLMCaller;
  completion?: { tool: string };
}

export interface ReActLoopResult {
  content: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  turns: number;
  lastPromptTokens?: number;
  termination: ReActTermination;
  autoOutcome?: 'completed' | 'anomaly';
}

export async function runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
  const caller: SharedLLMCaller = {
      call(messages, options, onChunk, signal, _tools, onReasoning) {
        return params.llm.call(messages, options, onChunk, signal, onReasoning);
      },
  };
  const input = {
    ...params,
    llm: params.llmTransform?.(caller) ?? caller,
  };
  const result = params.completion ? await runTextCompletion(input, params.completion.tool) : await runSharedTextLoop(input);

  return {
    content: result.content,
    rawContent: result.rawContent,
    toolCalls: result.toolCalls,
    turns: result.turns,
    lastPromptTokens: result.usage?.promptTokens,
    termination: result.termination,
    autoOutcome: result.autoOutcome,
  };
}
