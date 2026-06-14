/**
 * 对流原生 tool calls 适配器
 *
 * 职责：
 * - buildNativeConvectionProtocol：原生模式精简协议段（不教标签格式）
 * - runConvectionReActNative：adapter 注入共享 runReActLoopNative
 *
 * 从 handlers.ts 拆出，保持 handlers.ts ≤ 300 行。
 */

import type { ContextMessage } from '../shared/types';
import { callLLM, type TokenUsage } from '../shared/llm-bridge';
import type { ToolDef } from '../shared/tool-defs-loader';
import {
  runReActLoopNative,
  type LLMCaller,
  type ToolCaller,
  type ReActLoopResult,
} from '../conversation/react-loop';
import { callTool } from './tool-bridge';
import type { ToolCallRecord, ConvectionReActEvent } from './react-loop';

/**
 * 对流原生模式协议段：不教 <action>/<answer> 标签格式。
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
  signal?: AbortSignal;
}

/**
 * 对流原生 ReAct 适配器：包装 LLMCaller/ToolCaller 注入共享原生循环。
 */
export async function runConvectionReActNative(
  params: NativeAdapterParams,
): Promise<{ cleanContent: string; rawContent: string; toolCalls: ToolCallRecord[]; usage?: TokenUsage }> {
  const { dataDir, model, temperature, agentId, sessionId, label, messages, toolDefs, onEvent, signal } = params;
  const wsPath = `data/convection/sessions/${sessionId}/workspace`;

  const llm: LLMCaller = {
    async call(msgs, _opts, onChunk, sig, tools) {
      return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools });
    },
  };

  const toolCaller: ToolCaller = {
    async call(tool, args) {
      onEvent?.({ type: 'tool-call', label, tool, args });
      let result: string;
      try {
        result = await callTool({ tool, args, agentId, workspaceDir: wsPath });
      } catch (e) {
        const errMsg = `错误：${(e as Error).message}`;
        onEvent?.({ type: 'tool-result', label, tool, result: errMsg });
        throw e;
      }
      onEvent?.({ type: 'tool-result', label, tool, result });
      return result;
    },
  };

  // 事件翻译：共享循环的 ReActStreamEvent → 对流的 ConvectionReActEvent（加 label）
  const onLoopEvent = onEvent
    ? (ev: { type: string; chunk?: string; tool?: string; args?: Record<string, string>; result?: string; phase?: string; elapsed?: number; message?: string }) => {
        if (ev.type === 'token') onEvent({ type: 'token', label, chunk: ev.chunk! });
        else if (ev.type === 'heartbeat') onEvent({ type: 'heartbeat', label, phase: ev.phase as 'llm-waiting' | 'tool-exec', elapsed: ev.elapsed! });
        else if (ev.type === 'error') onEvent({ type: 'error', label, message: ev.message! });
      }
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
  };
}
