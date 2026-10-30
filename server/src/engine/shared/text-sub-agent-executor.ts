import { callLLM } from './llm-bridge.js';
import type { LoadedAgent } from './agent-loader.js';
import type { ToolDef } from './tool-defs-loader.js';
import type { SandboxLevel } from './sandbox-prompt.js';
import type { ContextMessage } from './types.js';
import type { SubAgentEvent, SubAgentResult } from './sub-agent-types.js';
import { buildTextToolProtocol } from './prompt.js';
import { runTextSubAgentLoop } from './text-sub-agent-loop.js';
import { subAgentCompaction } from './sub-agent-compaction.js';
import { callPreparedModel } from './react/model-call.js';
import type { CompactionArea } from './compaction/contracts.js';

export interface TextSubAgentParams {
  compactionArea?: CompactionArea;
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
  const llm = subAgentCompaction({ call: (context, _options, onChunk, signal, _tools, onReasoning) => callLLM({
    dataDir: params.dataDir, fullModelKey: params.model, messages: context,
    options: { temperature: params.agent.temperature }, onChunk, signal, onReasoning,
  }) }, params);
  try {
    const result = await runTextSubAgentLoop({
      messages,
      maxRounds: params.maxRounds,
      signal: params.signal,
      callModel: onPartial => callPreparedModel(llm, messages, params.signal, {
        onChunk: chunk => { onPartial?.(chunk); params.emitEvent({ type: 'token', data: { t: chunk } }); },
        onReasoning: chunk => params.emitEvent({ type: 'reasoning', data: { t: chunk } }),
      }),
      callTool: async (tool, args) => {
        const { executeToolOutcome } = await import('../../services/tool-executor.js');
        return executeToolOutcome(
          params.dataDir, tool, args, params.agent.id, undefined,
          params.parentSandboxLevel, undefined, params.signal,
        );
      },
      onToolCall: (tool, args) => params.emitEvent({ type: 'tool_call', data: { tool, args } }),
      onToolResult: (tool, result, ok, toolImages) => params.emitEvent({
        type: 'tool_result', data: { tool, result, ok, ...(toolImages?.length ? { toolImages } : {}) },
      }),
    });
    params.emitEvent({ type: result.status === 'error' ? 'error' : 'done', data: result });
    return result;
  } catch (cause) {
    return failed(params, cause);
  }
}
