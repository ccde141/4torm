import type { ContextMessage, LLMOptions } from '../shared/types.js';
import { callLLM, type TokenUsage } from '../shared/llm-bridge.js';
import { runReActLoop as runSharedTextLoop } from '../conversation/react-loop-text.js';
import type { ReActStreamEvent } from '../conversation/react-loop.js';
import { callTool } from './tool-bridge.js';

export interface ToolCallRecord {
  tool: string;
  args: Record<string, string>;
  result: string;
}

export interface AgentReActResult {
  cleanContent: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  usage?: TokenUsage;
}

export interface ConvectionReActEvent {
  type: 'token' | 'reasoning' | 'tool-call' | 'tool-result' | 'heartbeat' | 'error';
  label: string;
  chunk?: string;
  tool?: string;
  args?: Record<string, string>;
  result?: string;
  phase?: 'llm-waiting' | 'tool-exec';
  elapsed?: number;
  message?: string;
}

export interface RunReActParams {
  dataDir: string;
  model: string;
  temperature: number;
  agentId: string;
  sessionId: string;
  label: string;
  messages: ContextMessage[];
  onEvent?: (event: ConvectionReActEvent) => void;
  signal?: AbortSignal;
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
  callAgentTool(name: string, args: Record<string, string>): Promise<string>;
}

function mapEvent(label: string, event: ReActStreamEvent): ConvectionReActEvent | null {
  if (event.type === 'tool-progress') return null;
  return { ...event, label };
}

function defaultDependencies(params: RunReActParams): ConvectionTextDependencies {
  return {
    callModel: async (messages, options, onChunk, signal, onReasoning) => callLLM({
      dataDir: params.dataDir,
      fullModelKey: params.model,
      messages,
      options,
      onChunk,
      signal,
      onReasoning,
    }),
    callAgentTool: async (name, args) => callTool({
      tool: name,
      args,
      agentId: params.agentId,
      workspaceDir: `data/convection/sessions/${params.sessionId}/workspace`,
    }),
  };
}

export async function runConvectionReActWith(
  params: RunReActParams,
  dependencies: ConvectionTextDependencies,
): Promise<AgentReActResult> {
  const result = await runSharedTextLoop({
    messages: params.messages,
    llm: {
      call: (messages, options, onChunk, signal, _tools, onReasoning) => (
        dependencies.callModel(messages, options, onChunk, signal, onReasoning)
      ),
    },
    tools: { call: dependencies.callAgentTool },
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
  };
}

export function runConvectionReAct(params: RunReActParams): Promise<AgentReActResult> {
  return runConvectionReActWith(params, defaultDependencies(params));
}
