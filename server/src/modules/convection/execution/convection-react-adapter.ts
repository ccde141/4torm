import type { ContextMessage, LLMOptions } from '../../../engine/shared/types.js';
import { callLLM, type TokenUsage } from '../../../engine/shared/llm-bridge.js';
import { runReActLoop as runSharedTextLoop } from '../../../engine/shared/react/text-loop.js';
import type { LLMCaller, ReActStreamEvent, ToolCallOutcome } from '../../../engine/shared/react/native-loop.js';
import type { ReActTermination } from '../../../engine/shared/react/outcome.js';
import { callToolOutcome } from './tool-bridge.js';
import { executeConvectionMemoryTool } from './convection-memory.js';
import { legacyToolArguments } from '../../../engine/shared/tool-arguments.js';

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  toolImages?: import('../../../engine/shared/types.js').ToolImageRef[];
}

export interface AgentReActResult {
  cleanContent: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  usage?: TokenUsage;
  termination: ReActTermination;
}

export interface ConvectionReActEvent {
  type: 'token' | 'reasoning' | 'tool-call' | 'tool-result' | 'heartbeat' | 'error' | 'usage';
  label: string;
  chunk?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  ok?: boolean;
  toolImages?: import('../../../engine/shared/types.js').ToolImageRef[];
  phase?: 'llm-waiting' | 'tool-exec';
  elapsed?: number;
  message?: string;
  usage?: TokenUsage | null;
}

export interface RunReActParams {
  dataDir: string;
  model: string;
  temperature: number;
  agentId: string;
  sessionId: string;
  label: string;
  messages: ContextMessage[];
  allowedTools?: readonly string[];
  onEvent?: (event: ConvectionReActEvent) => void;
  /** 完成每次模型调用后先持久化，再让 ReAct 继续执行工具。 */
  onUsage?: (usage: TokenUsage | null) => Promise<void>;
  signal?: AbortSignal;
  llm?: LLMCaller;
}

interface ModelResult {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | null;
  usage?: TokenUsage;
}

export interface ConvectionTextDependencies {
  callModel(
    messages: ContextMessage[],
    options?: LLMOptions,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    onReasoning?: (chunk: string) => void,
  ): Promise<ModelResult>;
  callAgentTool(name: string, args: Record<string, unknown>): Promise<string | ToolCallOutcome>;
}

function mapEvent(label: string, event: ReActStreamEvent): ConvectionReActEvent | null {
  if (event.type === 'tool-progress') return null;
  return { ...event, label };
}

function defaultDependencies(params: RunReActParams): ConvectionTextDependencies {
  return {
    callModel: async (messages, options, onChunk, signal, onReasoning) => params.llm
      ? params.llm.call(messages, options, onChunk, signal, undefined, onReasoning)
      : callLLM({
      dataDir: params.dataDir,
      fullModelKey: params.model,
      messages,
      options,
      onChunk,
      signal,
      onReasoning,
    }),
    callAgentTool: async (name, args) => {
      const memoryResult = await executeConvectionMemoryTool(params.dataDir, params.agentId, name, legacyToolArguments(args));
      if (memoryResult !== null) return memoryResult;
      return callToolOutcome({
        mediaAccess: { dataDir: params.dataDir, feature: 'convection', target: { sessionId: params.sessionId } },
        tool: name,
        args,
        agentId: params.agentId,
        workspaceDir: `data/convection/sessions/${params.sessionId}/workspace`,
        signal: params.signal,
      });
    },
  };
}

export async function runConvectionReActWith(
  params: RunReActParams,
  dependencies: ConvectionTextDependencies,
): Promise<AgentReActResult> {
  const result = await runSharedTextLoop({
    messages: params.messages,
    llm: {
      call: async (messages, options, onChunk, signal, _tools, onReasoning) => {
        let response: ModelResult;
        try {
          response = await dependencies.callModel(
            messages,
            { temperature: params.temperature, ...options },
            onChunk,
            signal,
            onReasoning,
          );
        } catch (error) {
          await params.onUsage?.(null);
          throw error;
        }
        await params.onUsage?.(response.usage ?? null);
        return response;
      },
    },
    tools: { call: dependencies.callAgentTool },
    allowedTools: params.allowedTools,
    signal: params.signal,
    onEvent: event => {
      const mapped = mapEvent(params.label, event);
      if (mapped) params.onEvent?.(mapped);
    },
  });

  return {
    cleanContent: result.content,
    rawContent: result.rawContent,
    toolCalls: result.toolCalls,
    usage: result.usage,
    termination: result.termination,
  };
}

export function runConvectionReAct(params: RunReActParams): Promise<AgentReActResult> {
  return runConvectionReActWith(params, defaultDependencies(params));
}
