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
  /** 自动模式：显式终结工具门（传入则启用 complete_task 终结语义，见 conversation/react-loop.ts） */
  completion?: { tool: string };
}

/**
 * 信风原生 ReAct 适配器：包装参数注入共享原生循环。
 */
export async function runTradewindReActNative(
  params: NativeAdapterParams,
): Promise<{ content: string; rawContent: string; toolCalls: ToolCallRecord[]; turns: number; usage?: TokenUsage; lastPromptTokens?: number; autoOutcome?: 'completed' | 'anomaly' }> {
  const { dataDir, model, temperature, messages, toolDefs, toolCaller, onEvent, signal, completion } = params;

  const llm: LLMCaller = {
    async call(msgs, _opts, onChunk, sig, tools, onReasoning) {
      return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools, onReasoning });
    },
  };

  // 事件翻译：共享循环的 ReActStreamEvent → 信风 NodeRunnerEvent
  const onLoopEvent = onEvent
    ? (ev: NativeLoopEvent) => {
        const translated = translateNativeLoopEvent(ev);
        if (translated) onEvent(translated);
      }
    : undefined;

  const result: ReActLoopResult = await runReActLoopNative({
    messages,
    llm,
    tools: toolDefs.length > 0 ? toolCaller : undefined,
    toolDefs,
    onEvent: onLoopEvent,
    signal,
    completion,
    // 信风不注入 onToolError：无 ask、无挂起语义
  });

  return {
    content: result.content,
    rawContent: result.rawContent,
    toolCalls: result.toolCalls,
    turns: result.turns,
    usage: result.usage,
    lastPromptTokens: result.usage?.promptTokens,
    autoOutcome: result.autoOutcome,
  };
}

interface NativeLoopEvent {
  type: string;
  chunk?: string;
  message?: string;
}

export function translateNativeLoopEvent(event: NativeLoopEvent): NodeRunnerEvent | undefined {
  if (event.type === 'token') return { type: 'token', content: event.chunk ?? '' };
  if (event.type === 'reasoning') return { type: 'reasoning', content: event.chunk ?? '' };
  if (event.type === 'error') return { type: 'error', message: event.message ?? '' };
  return undefined;
}
