import type { NodeExecutor, WorkflowGraph, WorkflowMode } from '../engine/tradewind/foundation/types/index.js';
import { validateWorkflow } from '../engine/tradewind/foundation/workflow-validator.js';
import { Orchestrator, LoopController } from '../engine/tradewind/orchestrator/index.js';
import { EntryExecutor } from '../engine/tradewind/nodes/entry.js';
import { OutputExecutor } from '../engine/tradewind/nodes/output.js';
import { AgentExecutor } from '../engine/tradewind/nodes/agent.js';
import { MeetingExecutor } from '../engine/tradewind/nodes/meeting.js';
import { NoteExecutor } from '../engine/tradewind/nodes/note.js';
import { HumanGateExecutor } from '../engine/tradewind/nodes/human-gate.js';
import { autoProfileToLoopConfig, findProfile, loadProfiles } from '../engine/tradewind/foundation/profile-store.js';
import { pushExecutionLifecycle } from '../engine/tradewind/streaming/unified-stream.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import {
  getTradewindExecutions, reserveTradewindExecution, finishTradewindStart,
  selectTradewindExecution, slotIsRunning,
  type TradewindExecutionIdentity, type TradewindExecutionSlot,
} from './tradewind-execution-registry.js';
export { getTradewindExecutions } from './tradewind-execution-registry.js';
export type { TradewindExecutionIdentity } from './tradewind-execution-registry.js';

export interface TradewindTrigger {
  source: 'user' | 'conversation';
  sessionId?: string;
  agentId?: string;
}

export interface StartTradewindInput {
  dataDir: string;
  graph: WorkflowGraph;
  workflowId: string;
  initialInput?: string;
  mode?: WorkflowMode;
  profileId?: string;
  trigger: TradewindTrigger;
  workflowName?: string;
}

export interface TradewindStartResult {
  workflowId: string;
  workflowName: string;
  executionId: string;
  runDir: string;
  status: 'running';
  loop?: true;
}


function createExecutors(): Map<string, NodeExecutor> {
  return new Map<string, NodeExecutor>([
    ['entry', new EntryExecutor()],
    ['output', new OutputExecutor()],
    ['agent', new AgentExecutor()],
    ['meeting', new MeetingExecutor()],
    ['note', new NoteExecutor()],
    ['human-gate', new HumanGateExecutor()],
  ]);
}

export function getActiveTradewindOrchestrator(identity?: TradewindExecutionIdentity | string): Orchestrator | null {
  return selectTradewindExecution(identity)?.orchestrator ?? null;
}

export function getActiveTradewindLoop(identity?: TradewindExecutionIdentity | string): LoopController | null {
  return selectTradewindExecution(identity)?.loop ?? null;
}

export function isTradewindExecutionRunning(identity?: TradewindExecutionIdentity | string): boolean {
  if (identity === undefined) return getTradewindExecutions().some(slotIsRunning);
  const slot = selectTradewindExecution(identity);
  return !!slot && slotIsRunning(slot);
}

export function getStartingTradewindExecution(identity?: TradewindExecutionIdentity | string) {
  const slot = selectTradewindExecution(identity);
  return slot?.starting ? { workflowId: slot.workflowId, startedAt: slot.startedAt } : null;
}

/** No identity is the process shutdown path. UI actions always pass the exact execution. */
export async function stopActiveTradewindExecution(identity?: TradewindExecutionIdentity | string): Promise<void> {
  const selected = identity === undefined ? getTradewindExecutions() : [selectTradewindExecution(identity)];
  const results = await Promise.allSettled(selected.filter((slot): slot is TradewindExecutionSlot => !!slot && slotIsRunning(slot))
    .map(async slot => {
      slot.cancelled = true;
      if (slot.loop) await slot.loop.stop();
      else if (slot.orchestrator) await slot.orchestrator.stop();
      await slot.whenStarted;
      if (slot.orchestrator?.isRunning()) await slot.orchestrator.stop();
    }));
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, '停止信风执行失败');
}
export async function startTradewindExecution(input: StartTradewindInput): Promise<TradewindStartResult> {
  const slot = reserveTradewindExecution(input.dataDir, input.workflowId);
  try {
    const executors = createExecutors();
    const mode: WorkflowMode = input.mode === 'auto' ? 'auto' : 'manual';
    if (input.profileId && mode !== 'auto') throw frameworkError({
      code: 'TRADEWIND_PROFILE_MODE_INVALID', kind: 'validation',
      message: '使用循环档案时必须显式选择 auto 无人值守模式', source: 'tradewind.execution', retryable: false,
    });
    const errors = await validateWorkflow(input.graph, input.dataDir, new Set(executors.keys()), mode);
    if (errors.length > 0) {
      const error = new Error('工作流校验未通过') as Error & { validationErrors?: unknown };
      error.validationErrors = errors;
      throw error;
    }

    let loopConfig = null;
    if (mode === 'auto' && input.profileId) {
      const profiles = await loadProfiles(input.dataDir, input.workflowId);
      const profile = findProfile(profiles, input.profileId);
      if (!profile) throw new Error(`档案不存在：${input.profileId}`);
      if (profile.cadence.kind !== 'relative') throw frameworkError({
        code: 'TRADEWIND_PROFILE_CADENCE_UNSUPPORTED', kind: 'validation',
        message: '当前循环执行仅支持 relative 相对间隔，absolute/tide 档案尚不能启动',
        source: 'tradewind.execution', retryable: false,
      });
      loopConfig = autoProfileToLoopConfig(profile);
    }

    if (slot.cancelled) throw frameworkError({ code: 'TRADEWIND_START_ABORTED', kind: 'conflict',
      message: '信风启动已被停止', source: 'tradewind.execution', retryable: false });
    const workflowName = input.workflowName?.trim() || input.workflowId;
    if (loopConfig) {
      slot.loop = new LoopController({
        graph: input.graph,
        dataDir: input.dataDir,
        workflowId: input.workflowId,
        executors,
        initialInput: input.initialInput,
        mode,
        loop: loopConfig,
        onLapStart: orchestrator => { slot.orchestrator = orchestrator; },
      });
      await slot.loop.start();
    } else {
      slot.loop = null;
      slot.orchestrator = new Orchestrator({
        graph: input.graph,
        dataDir: input.dataDir,
        workflowId: input.workflowId,
        executors,
        initialInput: input.initialInput,
        mode,
        trigger: input.trigger,
      });
      await slot.orchestrator.start();
    }

    if (slot.cancelled) {
      await slot.orchestrator?.stop();
      throw frameworkError({ code: 'TRADEWIND_START_ABORTED', kind: 'conflict',
        message: '信风启动已被停止', source: 'tradewind.execution', retryable: false });
    }
    const result: TradewindStartResult = {
      workflowId: input.workflowId,
      workflowName,
      executionId: slot.orchestrator?.getExecutionId() ?? '',
      runDir: slot.orchestrator?.getRunDir() ?? '',
      status: 'running',
      ...(slot.loop ? { loop: true as const } : {}),
    };
    pushExecutionLifecycle({ type: 'execution-started', ...result, trigger: input.trigger });
    return result;
  } catch (error) {
    if (slot.cancelled && error instanceof Error && error.name === 'AbortError') throw frameworkError({
      code: 'TRADEWIND_START_ABORTED', kind: 'conflict', message: '信风启动已被停止',
      source: 'tradewind.execution', retryable: false,
    }, { cause: error });
    throw error;
  } finally {
    finishTradewindStart(slot);
  }
}
