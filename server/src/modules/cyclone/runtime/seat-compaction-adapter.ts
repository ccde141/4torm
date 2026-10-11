import { planSeatCompaction, type SeatCompactionPlan } from '../../../engine/cyclone/seat-compaction.js';
import { applySeatCompaction } from '../../../engine/cyclone/seat-compaction-store.js';
import {
  generateSeatCompactionSummary,
  resolveSeatCompactionModel,
} from '../../../engine/cyclone/seat-compaction-summary.js';
import type { SeatData } from '../../../engine/cyclone/types.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import type {
  CycloneSeatCompactionPort,
  PreparedCycloneSeatCompaction,
  StartCycloneSeatCompactionInput,
} from '../application/seat-compaction.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneChangeFeed } from '../application/change-feed.js';
import { archiveCycloneCompaction } from '../../../engine/cyclone/compaction-archive.js';
import { saveSeat } from '../../../engine/cyclone/seat-store.js';
import type { CompactionNotice } from '../../../engine/shared/compaction/index.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';

type ReadyPlan = Extract<SeatCompactionPlan, { ok: true }>;

export interface CycloneSeatCompactionRuntime {
  plan(messages: SeatData['messages'], promptTokens?: number): SeatCompactionPlan;
  resolveModel(dataDir: string, agentId: string): Promise<string>;
  summarize(input: { dataDir: string; model: string; agentId: string; subject: string; summaryInput: string;
    signal: AbortSignal; onChunk(chunk: string): void;
    onNotice?(notice: CompactionNotice): void | Promise<void> }): Promise<string>;
  apply(dataDir: string, workshopId: string, seat: SeatData, plan: ReadyPlan,
    summary: string, archivePath?: string): Promise<{ archivedCount: number }>;
  archive?(dataDir: string, workshopId: string, seat: SeatData, plan: ReadyPlan): Promise<string>;
}

const defaultRuntime: CycloneSeatCompactionRuntime = {
  plan: planSeatCompaction,
  resolveModel: resolveSeatCompactionModel,
  summarize: async input => generateSeatCompactionSummary({
    dataDir: input.dataDir, fullModelKey: input.model, subject: input.subject,
    summaryInput: input.summaryInput, signal: input.signal, onChunk: input.onChunk,
    onNotice: input.onNotice,
    compactionPrompt: (await loadAgent(input.dataDir, input.agentId))?.compactionPrompt,
  }),
  apply: applySeatCompaction,
  archive: (dataDir, workshopId, seat, plan) => archiveCycloneCompaction(dataDir, workshopId, `seat-${seat.id}`,
    { type: 'cyclone-seat-context-compact', seatId: seat.id, messages: plan.archivedMessages }),
};

export function createCycloneSeatCompactionPort(
  dataDir: string,
  seats: CycloneSeatService,
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  runtime: CycloneSeatCompactionRuntime = defaultRuntime,
  changes?: CycloneChangeFeed,
): CycloneSeatCompactionPort {
  return { prepare: async input => {
    const execution = await commands.begin({ workshopId: input.workshopId,
      targetKind: 'seat', targetId: input.seatId, phase: 'seat-compact' });
    changes?.publish(input.workshopId, 'activity', input.seatId);
    let agentId: string | undefined;
    try {
      const seat = await seats.require(input.workshopId, input.seatId);
      agentId = seat.agentId;
      validateSeat(seat);
      const plan = runtime.plan(seat.messages || [], seat.tokenUsage?.promptTokens);
      if (!plan.ok) throw planError(plan);
      const model = await runtime.resolveModel(dataDir, seat.agentId);
      return { execution, run: onEvent => runCompaction(
        dataDir, input, seat, plan, model, execution, commands, executions, runtime, onEvent, changes,
      ) };
    } catch (error) {
      await commands.finish({ operationId: execution.operationId, runId: execution.runId,
        status: 'failed', error: errorMessage(error),
        ...(agentId ? { agentIds: [agentId] } : {}) });
      changes?.publish(input.workshopId, 'activity', input.seatId);
      throw error;
    }
  } };
}

async function runCompaction(
  dataDir: string,
  input: StartCycloneSeatCompactionInput,
  seat: SeatData,
  plan: ReadyPlan,
  model: string,
  execution: PreparedCycloneSeatCompaction['execution'],
  commands: CycloneCommands,
  executions: CycloneExecutionPort,
  runtime: CycloneSeatCompactionRuntime,
  onEvent?: (event: unknown) => void,
  changes?: CycloneChangeFeed,
): Promise<void> {
  const signal = executions.signal(execution.operationId, execution.runId);
  onEvent?.({ type: 'start', compressedCount: plan.archivedMessages.length, keptTurnCount: plan.keptTurnCount });
  let failure: unknown;
  try {
    const archivePath = await runtime.archive?.(dataDir, input.workshopId, seat, plan);
    const summary = await runtime.summarize({ dataDir, model, agentId: seat.agentId,
      subject: `工位「${seat.title}」私聊`, summaryInput: plan.summaryInput, signal,
      onChunk: content => onEvent?.({ type: 'token', content }),
      onNotice: async notice => {
        seat.compactionNotice = notice;
        await saveSeat(dataDir, input.workshopId, seat);
        onEvent?.(notice);
      } });
    const result = await runtime.apply(dataDir, input.workshopId, seat, plan, summary, archivePath);
    changes?.publish(input.workshopId, 'activity', input.seatId);
    onEvent?.({ type: 'done', archivedCount: result.archivedCount, keptTurnCount: plan.keptTurnCount });
  } catch (error) { failure = error; }
  const status = signal.aborted ? 'aborted' : failure ? 'failed' : 'completed';
  await commands.finish({ operationId: execution.operationId, runId: execution.runId, status,
    agentIds: [seat.agentId],
    ...(failure ? { error: errorMessage(failure) } : {}) });
  changes?.publish(input.workshopId, 'activity', input.seatId);
  if (failure) throw signal.aborted ? new Error('上下文压缩已停止') : failure;
}

function validateSeat(seat: SeatData): void {
  if (seat.pending) throw compactError('CYCLONE_SEAT_COMPACT_PENDING', 'conflict',
    '该工位存在挂起提问，请先完成回答');
}

function planError(plan: Exclude<SeatCompactionPlan, { ok: true }>): Error {
  return compactError('CYCLONE_SEAT_COMPACT_NOT_NEEDED', 'validation', '没有可压缩的完整会话内容');
}

function compactError(code: string, kind: 'validation' | 'conflict', message: string): Error {
  return frameworkError({ code, kind, message, source: 'cyclone.seat-compaction', retryable: false });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
