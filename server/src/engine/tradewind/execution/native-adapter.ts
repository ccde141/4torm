/**
 * 信风原生 tool calls 适配器
 *
 * 职责：
 * - 包装 LLMCaller / ToolCaller 适配共享原生循环的类型约束
 * - 调用 runReActLoopNative（core 循环，不含业务挂起语义）
 * - 信风不需要 onToolError hook（无 ask / 无挂起）
 *
 * 信风文本循环保留在 react-loop.ts（含 delegate nudge / reminder），native 路径独立。
 */

import type { ContextMessage } from '../../shared/types';
import { callLLM, type TokenUsage } from '../../shared/llm-bridge';
import type { ToolDef } from '../../shared/tool-defs-loader';
import {
  runReActLoopNative,
  type LLMCaller,
  type ToolCaller,
  type ReActLoopResult,
} from '../../conversation/react-loop';
import type { ToolCallRecord } from './react-loop';
import type { NodeRunnerEvent } from './node-runner';

export interface NativeAdapterParams {
  dataDir: string;
  model: string;
  temperature: number;
  messages: ContextMessage[];
  toolDefs: ToolDef[];
  /** 工具执行器（由 NodeRunner 注入，已包含 delegate/contact 路由） */
  toolCaller: ToolCaller;
  onEvent?: (ev: NodeRunnerEvent) => void;
  signal?: AbortSignal;
}

/**
 * 信风原生 ReAct 适配器：包装参数注入共享原生循环。
 */
export async function runTradewindReActNative(
  params: NativeAdapterParams,
): Promise<{ content: string; rawContent: string; toolCalls: ToolCallRecord[]; turns: number; usage?: TokenUsage; lastPromptTokens?: number }> {
  const { dataDir, model, temperature, messages, toolDefs, toolCaller, onEvent, signal } = params;

  const llm: LLMCaller = {
    async call(msgs, _opts, onChunk, sig, tools) {
      return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools });
    },
  };

  // 事件翻译：共享循环的 ReActStreamEvent → 信风 NodeRunnerEvent
  const onLoopEvent = onEvent
    ? (ev: { type: string; chunk?: string; tool?: string; args?: Record<string, string>; result?: string; phase?: string; elapsed?: number; message?: string }) => {
        if (ev.type === 'token') onEvent({ type: 'token', content: ev.chunk! });
        // tool-call / tool-result 由 toolCaller 内部 emit，循环只补发旁路事件
        else if (ev.type === 'error') onEvent({ type: 'error', message: ev.message! });
      }
    : undefined;

  const result: ReActLoopResult = await runReActLoopNative({
    messages,
    llm,
    tools: toolDefs.length > 0 ? toolCaller : undefined,
    toolDefs,
    onEvent: onLoopEvent,
    signal,
    // 信风不注入 onToolError：无 ask、无挂起语义
  });

  return {
    content: result.content,
    rawContent: result.rawContent,
    toolCalls: result.toolCalls,
    turns: result.turns,
    usage: result.usage,
    lastPromptTokens: result.usage?.promptTokens,
  };
}
