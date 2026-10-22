import fs from 'node:fs/promises';
import path from 'node:path';
import { activeHumanGates } from '../../../engine/tradewind/nodes/human-gate.js';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import {
  getActiveTradewindOrchestrator,
  getTradewindExecutions,
} from '../../../services/tradewind-execution.js';
import { slotIsRunning, type TradewindExecutionSlot } from '../../../services/tradewind-execution-registry.js';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindWorkflowStore } from '../application/workflow-store.js';
import { createTradewindWorkflowStore } from './workflow-store.js';
import type { TradewindExecutionSnapshot, TradewindRuntimeSource } from '../domain/execution-snapshot.js';
import { readArchiveFailureFact } from './archive-failure-fact.js';

export function createTradewindRuntimeSource(
  dataDir: string,
  store: TradewindWorkflowStore = createTradewindWorkflowStore(dataDir),
): TradewindRuntimeSource {
  return {
    snapshots: () => readSnapshots(store, dataDir),
    inspect: identity => inspectExecution(dataDir, store, identity),
    subscribe: (identity, listener) => subscribeToExecution(identity, listener, dataDir),
  };
}

async function inspectExecution(
  dataDir: string,
  store: TradewindWorkflowStore,
  identity: { operationId: string; runId: string },
): Promise<TradewindExecutionSnapshot | null> {
  const live = (await readSnapshots(store, dataDir)).find(item =>
    item.operationId === identity.operationId && item.runId === identity.runId);
  const runDir = tradewindRunDir(dataDir, identity.operationId, identity.runId);
  if (live) return withResultSummary(live, runDir);
  if (!isIdentifier(identity.operationId) || !isIdentifier(identity.runId)) return null;
  const file = path.join(runDir, 'meta.json');
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    if (value.workflowId !== identity.operationId || value.executionId !== identity.runId) return null;
    const failure = await readArchiveFailureFact(runDir, value.status);
    const status = failure ? 'failed' : archivedStatus(value.status);
    if (!status) return null;
    return withResultSummary({
      operationId: identity.operationId, runId: identity.runId,
      title: await readTitle(store, identity.operationId), status,
      updatedAt: failure?.endTime ?? timestamp(value.endTime) ?? timestamp(value.startTime),
      ...(status === 'failed' || status === 'crashed' ? {
        errorCode: failure?.errorCode ?? storedFailure(value)?.errorCode ?? (status === 'crashed'
          ? 'TRADEWIND_PROCESS_RESTARTED' : 'TRADEWIND_EXECUTION_FAILED'),
        errorMessage: failure?.errorMessage ?? storedFailure(value)?.errorMessage ?? (status === 'crashed'
          ? '信风执行随进程结束，无法继续' : '信风工作流执行失败'),
      } : {}),
    }, runDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function withResultSummary(
  snapshot: TradewindExecutionSnapshot,
  runDir: string,
): Promise<TradewindExecutionSnapshot> {
  if (snapshot.status !== 'completed') return snapshot;
  const resultSummary = await readResultSummary(runDir);
  return resultSummary ? { ...snapshot, resultSummary } : snapshot;
}

async function readResultSummary(runDir: string): Promise<string | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(runDir, 'output.json'), 'utf8')) as unknown;
    if (!Array.isArray(value)) throw new Error('信风输出文件格式无效');
    const lines = value.map((item, index) => {
      if (!record(item) || typeof item.source !== 'string' || typeof item.content !== 'string') {
        throw new Error(`信风输出条目无效：${index}`);
      }
      return `${item.source}: ${item.content}`;
    });
    const text = lines.join('\n').trim();
    return text ? text.slice(0, 12_000) : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function archivedStatus(value: unknown): TradewindExecutionSnapshot['status'] | null {
  if (value === 'running') return 'running';
  if (value === 'done') return 'completed';
  if (value === 'stopped') return 'aborted';
  if (value === 'error') return 'failed';
  if (value === 'crashed') return 'crashed';
  return null;
}

function timestamp(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function storedFailure(value: Record<string, unknown>) {
  if (value.status !== 'error') return undefined;
  return {
    errorCode: typeof value.errorCode === 'string' && /^[A-Z][A-Z0-9_.:-]{0,127}$/.test(value.errorCode)
      ? value.errorCode : undefined,
    errorMessage: typeof value.errorMessage === 'string' && value.errorMessage.trim()
      ? value.errorMessage.trim().slice(0, 2_000) : undefined,
  };
}

function isIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function subscribeToExecution(
  identity: { operationId: string; runId: string },
  listener: () => void,
  dataDir: string,
): () => void {
  const orchestrator = getActiveTradewindOrchestrator({ workflowId: identity.operationId, executionId: identity.runId, dataDir });
  if (orchestrator?.getWorkflowId() !== identity.operationId
    || orchestrator.getExecutionId() !== identity.runId) return () => undefined;
  let active = true;
  void orchestrator.whenSettled().then(() => { if (active) listener(); });
  return () => { active = false; };
}

async function readSnapshots(store: TradewindWorkflowStore, dataDir: string): Promise<TradewindExecutionSnapshot[]> {
  const snapshots = await Promise.all(getTradewindExecutions(dataDir).map(slot => slotSnapshots(store, slot)));
  return snapshots.flat();
}

async function slotSnapshots(store: TradewindWorkflowStore, slot: TradewindExecutionSlot): Promise<TradewindExecutionSnapshot[]> {
  if (slot.starting && !slot.orchestrator) return [{
    operationId: slot.workflowId, title: await readTitle(store, slot.workflowId),
    status: 'queued', phase: 'starting', updatedAt: slot.startedAt,
  }];
  const orchestrator = slot.orchestrator;
  if (!orchestrator) return [];
  const workflowId = orchestrator.getWorkflowId();
  const executionId = orchestrator.getExecutionId();
  const running = slotIsRunning(slot);
  const outcome = orchestrator.getOutcome();
  const failure = orchestrator.getFailure();
  const gates = [...activeHumanGates.entries()]
    .filter(([, gate]) => gate.executionId === executionId);
  const waiting = running && gates.length > 0;
  const parent: TradewindExecutionSnapshot = {
    operationId: workflowId, title: await readTitle(store, workflowId), runId: executionId,
    status: waiting ? 'waiting' : running ? 'running'
      : outcome === 'done' ? 'completed' : outcome === 'stopped' ? 'aborted' : 'failed',
    phase: waiting ? 'human-gate' : slot.loop?.isRunning() ? 'loop' : undefined,
    ...(waiting ? { waitingReason: `等待 ${gates.length} 个人类关口` } : {}),
    ...(!running && outcome === 'error'
      ? { errorCode: failure?.data.code ?? 'TRADEWIND_EXECUTION_FAILED',
        errorMessage: failure?.message ?? '信风工作流执行失败' } : {}),
  };
  if (!running) return [parent];
  return [parent, ...nodeSnapshots(workflowId, executionId, gates)];
}

function nodeSnapshots(
  workflowId: string,
  executionId: string,
  gates: Array<[string, { envelopeContent: string; arrivedAt: number; executionId: string }]>,
): TradewindExecutionSnapshot[] {
  const nodes = [...activeNodeRunners.entries()]
    .filter(([, runner]) => runner.getIdentity().executionId === executionId)
    .map(([nodeId, runner]) => {
      const state = runner.getRuntimeState();
      return child(workflowId, nodeId, state.paused ? 'waiting' : state.busy ? 'running' : 'idle',
        state.paused ? 'agent-paused' : state.roundSource ? `agent-${state.roundSource}` : 'agent',
        state.runId, state.paused ? '等待恢复信封轮次' : undefined,
        runner.getAgentId());
    });
  const meetings = [...activeMeetings.entries()]
    .filter(([, meeting]) => meeting.executionId === executionId)
    .map(([nodeId, meeting]) => child(
      workflowId, nodeId,
      meeting.session.busy ? 'running' : 'waiting',
      `meeting-${meeting.session.phase}`,
      meeting.roundIdentity?.runId,
      meeting.session.busy ? undefined : '等待人类继续会议',
    ));
  const humanGates = gates.map(([nodeId, gate]) => ({
    ...child(workflowId, nodeId, 'waiting', 'human-gate', undefined, '等待人类提交'),
    updatedAt: new Date(gate.arrivedAt).toISOString(),
  }));
  return [...nodes, ...meetings, ...humanGates]
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
}

function child(
  workflowId: string,
  nodeId: string,
  status: TradewindExecutionSnapshot['status'],
  phase: string,
  runId?: string,
  waitingReason?: string,
  agentId?: string,
): TradewindExecutionSnapshot {
  return {
    operationId: `node:${workflowId}:${nodeId}`, parentOperationId: workflowId,
    title: nodeId, status, phase, ...(runId ? { runId } : {}),
    ...(waitingReason ? { waitingReason } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

async function readTitle(store: TradewindWorkflowStore, workflowId: string): Promise<string> {
  try {
    return (await store.read(workflowId)).name;
  } catch (error) {
    if (error instanceof FrameworkError && error.data.kind === 'not_found') return workflowId;
    throw error;
  }
}
