import { callLLM } from './llm-bridge.js';
import type { LoadedAgent } from './agent-loader.js';
import type { ToolDef } from './tool-defs-loader.js';
import type { SandboxLevel } from './sandbox-prompt.js';
import type { ContextMessage } from './types.js';
import type { SubAgentEvent, SubAgentResult } from './sub-agent-types.js';
import { buildTextToolProtocol } from './prompt.js';
import { runTextSubAgentLoop } from './text-sub-agent-loop.js';

export interface TextSubAgentParams {
  agent: LoadedAgent;
  model: string;
  tools: ToolDef[];
  systemPrompt: string;
  task: string;
  context: string;
  dataDir: string;
  sandboxSection: string;
  escalationNote: string;
  constraintsSection: string;
  maxRounds: number;
  signal: AbortSignal;
  emitEvent: (event: SubAgentEvent) => void;
  parentSandboxLevel: SandboxLevel;
}

function failed(params: TextSubAgentParams, cause: unknown): SubAgentResult {
  const result: SubAgentResult = params.signal.aborted
    ? { status: 'aborted', summary: 'SubAgent 被外部中止', rounds: 0 }
    : { status: 'error', summary: 'LLM 调用失败', rounds: 0, error: (cause as Error).message };
  params.emitEvent({ type: result.status === 'error' ? 'error' : 'done', data: result });
  return result;
}

export async function runTextSubAgent(params: TextSubAgentParams): Promise<SubAgentResult> {
  const messages: ContextMessage[] = [
    {
      role: 'system',
      content: [
        params.systemPrompt,
        buildTextToolProtocol(params.tools),
        params.sandboxSection,
        params.escalationNote,
        params.constraintsSection,
      ].join('\n\n'),
    },
    { role: 'user', content: `任务：${params.task}\n\n背景：${params.context}` },
  ];
  try {
    const result = await runTextSubAgentLoop({
      messages,
      maxRounds: params.maxRounds,
      signal: params.signal,
      callModel: () => callLLM({
        dataDir: params.dataDir,
        fullModelKey: params.model,
        messages,
        options: { temperature: params.agent.temperature },
        onChunk: chunk => params.emitEvent({ type: 'token', data: { t: chunk } }),
        signal: params.signal,
      }),
      callTool: async (tool, args) => {
        const { executeTool } = await import('../../services/tool-executor.js');
        return executeTool(
          params.dataDir, tool, args, params.agent.id, undefined,
          params.parentSandboxLevel, undefined, params.signal,
        );
      },
      onToolCall: (tool, args) => params.emitEvent({ type: 'tool_call', data: { tool, args } }),
      onToolResult: (tool, result, ok) => params.emitEvent({
        type: 'tool_result', data: { tool, result, ok },
      }),
    });
    params.emitEvent({ type: result.status === 'error' ? 'error' : 'done', data: result });
    return result;
  } catch (cause) {
    return failed(params, cause);
  }
}
