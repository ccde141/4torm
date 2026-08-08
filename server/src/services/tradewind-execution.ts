import fs from 'node:fs/promises';
import path from 'node:path';
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
import { tradewindWorkflowDir } from './data-paths.js';

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
}

export interface TradewindStartResult {
  workflowId: string;
  workflowName: string;
  executionId: string;
  runDir: string;
  status: 'running';
  loop?: true;
}

let activeOrchestrator: Orchestrator | null = null;
let activeLoop: LoopController | null = null;
let starting = false;

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

export function getActiveTradewindOrchestrator(): Orchestrator | null {
  return activeOrchestrator;
}

export function getActiveTradewindLoop(): LoopController | null {
  return activeLoop;
}

export function isTradewindExecutionRunning(): boolean {
  return starting || !!(activeLoop?.isRunning() || activeOrchestrator?.isRunning());
}

export async function stopActiveTradewindExecution(): Promise<void> {
  if (activeLoop?.isRunning()) {
    await activeLoop.stop();
    activeLoop = null;
    return;
  }
  if (activeOrchestrator?.isRunning()) await activeOrchestrator.stop();
}

export async function startTradewindExecution(input: StartTradewindInput): Promise<TradewindStartResult> {
  if (isTradewindExecutionRunning()) throw new Error('已有信风工作流正在运行');
  starting = true;
  try {
    const executors = createExecutors();
    const mode: WorkflowMode = input.mode === 'auto' ? 'auto' : 'manual';
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
      loopConfig = autoProfileToLoopConfig(profile);
    }

    const workflowName = await loadWorkflowName(input.dataDir, input.workflowId);
    if (loopConfig) {
      activeLoop = new LoopController({
        graph: input.graph,
        dataDir: input.dataDir,
        workflowId: input.workflowId,
        executors,
        initialInput: input.initialInput,
        mode,
        loop: loopConfig,
        onLapStart: orchestrator => { activeOrchestrator = orchestrator; },
      });
      await activeLoop.start();
    } else {
      activeLoop = null;
      activeOrchestrator = new Orchestrator({
        graph: input.graph,
        dataDir: input.dataDir,
        workflowId: input.workflowId,
        executors,
        initialInput: input.initialInput,
        mode,
        trigger: input.trigger,
      });
      await activeOrchestrator.start();
    }

    const result: TradewindStartResult = {
      workflowId: input.workflowId,
      workflowName,
      executionId: activeOrchestrator?.getExecutionId() ?? '',
      runDir: activeOrchestrator?.getRunDir() ?? '',
      status: 'running',
      ...(activeLoop ? { loop: true as const } : {}),
    };
    pushExecutionLifecycle({ type: 'execution-started', ...result, trigger: input.trigger });
    return result;
  } finally {
    starting = false;
  }
}

export async function startStoredTradewindExecution(input: {
  dataDir: string;
  workflowId: string;
  initialInput?: string;
  trigger: TradewindTrigger;
}): Promise<TradewindStartResult> {
  const workflowDir = tradewindWorkflowDir(input.dataDir, input.workflowId);
  const raw = await fs.readFile(path.join(workflowDir, 'graph.json'), 'utf8');
  const graph = JSON.parse(raw) as WorkflowGraph;
  return startTradewindExecution({ ...input, graph, mode: 'manual' });
}

async function loadWorkflowName(dataDir: string, workflowId: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(tradewindWorkflowDir(dataDir, workflowId), 'meta.json'), 'utf8');
    const meta = JSON.parse(raw) as { name?: string };
    return meta.name?.trim() || workflowId;
  } catch {
    return workflowId;
  }
}
