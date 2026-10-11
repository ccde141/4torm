import type { ContextMessage } from '../../../engine/shared/types.js';
import type { SandboxLevel } from '../../../services/execution-context.js';
import type { ToolPreparationProgress } from '../../../engine/shared/tool-progress.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { FrameworkErrorKind } from '../../../engine/shared/framework-error.js';
import type { MonsoonContextMarker } from '../application/context-port.js';

export interface MonsoonTurnSpec {
  dataDir: string;
  agentId: string;
  sessionId: string;
  model: string;
  temperature: number;
  toolNames: string[];
  toolMode: 'all' | 'selected';
  skillIds: string[];
  workspace: string;
  sandboxLevel: SandboxLevel;
  native: boolean;
}

export interface MonsoonInputReceipt {
  id: string;
  content: string;
  runId: string;
  sequence: number;
  receivedAt: string;
}

export interface MonsoonInputRuntime {
  owner: { agentId: string; sessionId: string; runId: string };
  submit(value: unknown): Promise<MonsoonInputReceipt>;
}

export type MonsoonInputEvent =
  | { type: 'input-ready'; runId: string }
  | { type: 'input-received'; receipt: MonsoonInputReceipt }
  | { type: 'input-context'; runId: string; checkpoint: {
    context: ContextMessage[]; includedIds: string[]; closed: boolean;
  } }
  | { type: 'input-closed'; runId: string; retained: MonsoonInputReceipt[] }
  | { type: 'input-skipped'; tool: string; reason: string };

export type MonsoonEvent = MonsoonInputEvent
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'notice'; message: string }
  | { type: 'compaction-notice'; message: string }
  | { type: 'context-compacted'; revision: number; marker: MonsoonContextMarker }
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | ({ type: 'tool-progress' } & ToolPreparationProgress)
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: unknown }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'reply-accepted'; waitingRunId: string; answer: string }
  | { type: 'answer'; content: string; rawContent: string; native?: boolean; nativeContext?: ContextMessage[] }
  | { type: 'usage'; usage: TokenUsage | null }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind }
  | { type: 'done' };

export interface MonsoonTurn {
  isBusy(): boolean;
  isSuspended(): boolean;
  getAgentId(): string;
  getInputRuntime(): MonsoonInputRuntime | null;
  abort(): void;
  chat(prompt: string, messages: ContextMessage[], emit: (event: MonsoonEvent) => void,
    runId?: string): Promise<{ content: string; rawContent: string }>;
  resume(answer: string, emit: (event: MonsoonEvent) => void,
    runId?: string): Promise<{ content: string; rawContent: string }>;
}
