import type { SandboxLevel } from '../shared/sandbox-prompt.js';
import type { SubAgentEvent } from '../shared/sub-agent-types.js';
import type { SubAgentParams, SubAgentResult } from '../shared/sub-agent-types.js';

export type DelegateToolEvent =
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string };

interface DelegateToolInput {
  args: Record<string, string>;
  dataDir: string;
  agentId: string;
  model: string;
  sandboxLevel: SandboxLevel;
  signal: AbortSignal;
  emit: (event: DelegateToolEvent) => void;
}

type DelegateRunner = (params: SubAgentParams) => Promise<SubAgentResult>;
export interface DelegateToolOutcome { result: string; ok: boolean }

export async function executeDelegateTool(input: DelegateToolInput, run?: DelegateRunner): Promise<string> {
  return (await executeDelegateToolOutcome(input, run)).result;
}

export async function executeDelegateToolOutcome(
  input: DelegateToolInput, run?: DelegateRunner,
): Promise<DelegateToolOutcome> {
  const runner = run ?? (await import('../shared/sub-agent-runner.js')).runSubAgent;
  const task = input.args.task || '';
  const delegateId = `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  input.emit({ type: 'delegate-start', task, delegateId });

  const result = await runner({
    task,
    context: input.args.context || '',
    systemPrompt: input.args.systemPrompt || '',
    agentId: input.agentId,
    model: input.model,
    dataDir: input.dataDir,
    signal: input.signal,
    timeout: 1_200_000,
    maxRounds: 100,
    parentSandboxLevel: input.sandboxLevel,
    emit: event => forwardEvent(event, delegateId, input.emit),
  });

  input.emit({
    type: 'delegate-done', delegateId, summary: result.summary, status: result.status,
  });
  return { result: `[${result.status}] ${result.summary}`, ok: result.status === 'success' };
}

function forwardEvent(
  event: SubAgentEvent,
  delegateId: string,
  emit: (event: DelegateToolEvent) => void,
): void {
  if (event.type === 'token' || event.type === 'reasoning') {
    emit({ type: 'delegate-token', delegateId, content: event.data.t });
  } else if (event.type === 'tool_call') {
    emit({ type: 'delegate-tool-call', delegateId,
      tool: event.data.tool, args: event.data.args });
  } else if (event.type === 'tool_result') {
    emit({ type: 'delegate-tool-result', delegateId,
      tool: event.data.tool, result: event.data.result, ok: event.data.ok });
  }
}
