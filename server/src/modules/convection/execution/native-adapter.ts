/**
 * 对流原生 tool calls 适配器
 *
 * 职责：
 * - buildNativeConvectionProtocol：原生模式精简协议段（不教标签格式）
 * - runConvectionReActNative：adapter 注入共享 runReActLoopNative
 *
 * 从 handlers.ts 拆出，保持 handlers.ts ≤ 300 行。
 */

import type { ContextMessage } from '../../../engine/shared/types';
import { callLLM, type TokenUsage } from '../../../engine/shared/llm-bridge';
import type { ToolDef } from '../../../engine/shared/tool-defs-loader';
import {
  runReActLoopNative,
  type LLMCaller,
  type ToolCaller,
  type ToolCallOutcome,
  type ReActStreamEvent,
  type ReActLoopResult,
  normalizeToolCallResult,
} from '../../../engine/shared/react/native-loop';
import { callToolOutcome } from './tool-bridge';
import type { ToolCallRecord, ConvectionReActEvent } from './convection-react-adapter';
import { executeConvectionMemoryTool } from './convection-memory.js';
import { legacyToolArguments } from '../../../engine/shared/tool-arguments.js';
import type { ReActTermination } from '../../../engine/shared/react/outcome.js';

/**
 * 对流原生模式协议段：工具调用由 provider 的结构化通道承载。
 * 原生 function calling 由 provider 处理，模型直接自然语言输出即可。
 */
export function buildNativeConvectionProtocol(tools: ToolDef[]): string {
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  return `## 工作方式

你可以调用工具来完成任务。需要时直接发起工具调用，系统会执行并把结果返回给你。

- 需要外部信息或执行操作时，调用对应工具
- 串行依赖请分多轮调用，不要一次性堆叠
- 工具调用过程对其他参与者不可见，只有最终回答公开
- 完成后用自然语言直接给出最终回答即可

## 可用工具

${toolList}`;
}

export interface NativeAdapterParams {
  dataDir: string;
  model: string;
  temperature: number;
  agentId: string;
  sessionId: string;
  label: string;
  messages: ContextMessage[];
  toolDefs: ToolDef[];
  onEvent?: (ev: ConvectionReActEvent) => void;
  onUsage?: (usage: TokenUsage | null) => Promise<void>;
  signal?: AbortSignal;
  llm?: LLMCaller;
}

export interface ConvectionNativeDependencies {
  callModel: LLMCaller['call'];
  callAgentTool(tool: string, args: Record<string, unknown>): Promise<string | ToolCallOutcome>;
}

function defaultDependencies(params: NativeAdapterParams): ConvectionNativeDependencies {
  return {
    callModel: (msgs, opts, onChunk, sig, tools, onReasoning) => params.llm
      ? params.llm.call(msgs, opts, onChunk, sig, tools, onReasoning)
      : callLLM({
      dataDir: params.dataDir,
      fullModelKey: params.model,
      messages: msgs,
      options: { temperature: params.temperature },
      onChunk,
      signal: sig,
      tools,
      onReasoning,
    }),
    callAgentTool: async (tool, args) => {
      const memoryResult = await executeConvectionMemoryTool(params.dataDir, params.agentId, tool, legacyToolArguments(args));
      if (memoryResult !== null) return memoryResult;
      return callToolOutcome({ tool, args, agentId: params.agentId,
        mediaAccess: { dataDir: params.dataDir, feature: 'convection', target: { sessionId: params.sessionId } },
        workspaceDir: `data/convection/sessions/${params.sessionId}/workspace`, signal: params.signal });
    },
  };
}

/**
 * 对流原生 ReAct 适配器：包装 LLMCaller/ToolCaller 注入共享原生循环。
 */
export async function runConvectionReActNative(
  params: NativeAdapterParams,
): Promise<{
  cleanContent: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  usage?: TokenUsage;
  termination: ReActTermination;
}> {
  return runConvectionReActNativeWith(params, defaultDependencies(params));
}

export async function runConvectionReActNativeWith(
  params: NativeAdapterParams,
  dependencies: ConvectionNativeDependencies,
): Promise<{
  cleanContent: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  usage?: TokenUsage;
  termination: ReActTermination;
}> {
  const { label, messages, toolDefs, onEvent, signal } = params;

  const llm: LLMCaller = { prepare: params.llm?.prepare, recover: params.llm?.recover,
    call: async (...args) => {
    let response: Awaited<ReturnType<LLMCaller['call']>>;
    try { response = await dependencies.callModel(...args); }
    catch (error) {
      await params.onUsage?.(null);
      throw error;
    }
    await params.onUsage?.(response.usage ?? null);
    return response;
  } };

  const toolCaller: ToolCaller = {
    async call(tool, args) {
      onEvent?.({ type: 'tool-call', label, tool, args });
      let outcome: ToolCallOutcome;
      try {
        outcome = normalizeToolCallResult(await dependencies.callAgentTool(tool, args));
      } catch (e) {
        const errMsg = `错误：${(e as Error).message}`;
        onEvent?.({ type: 'tool-result', label, tool, result: errMsg, ok: false });
        throw e;
      }
      onEvent?.({ type: 'tool-result', label, tool, ...outcome });
      return outcome;
    },
  };

  // 事件翻译：共享循环的 ReActStreamEvent → 对流的 ConvectionReActEvent（加 label）
  const onLoopEvent = onEvent
    ? (ev: ReActStreamEvent) => { if (ev.type !== 'tool-progress') onEvent({ ...ev, label }); }
    : undefined;

  const result: ReActLoopResult = await runReActLoopNative({
    messages,
    llm,
    tools: toolDefs.length > 0 ? toolCaller : undefined,
    toolDefs,
    onEvent: onLoopEvent,
    signal,
  });

  return {
    cleanContent: result.content.trim(),
    rawContent: result.rawContent,
    toolCalls: result.toolCalls,
    usage: result.usage,
    termination: result.termination,
  };
}
