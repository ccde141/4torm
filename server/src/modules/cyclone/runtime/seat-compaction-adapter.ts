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
import type { CompactionNotice, CompactionProgress } from '../../../engine/shared/compaction/index.js';
import { startCycloneCompaction, finishCycloneCompaction } from '../../../engine/cyclone/compaction-progress.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { trackCyclonePreparation, trackCyclonePreparationStart } from '../application/execution-preparation.js';

type ReadyPlan = Extract<SeatCompactionPlan, { ok: true }>;

export interface CycloneSeatCompactionRuntime {
  plan(messages: SeatData['messages'], promptTokens?: number): SeatCompactionPlan;
  resolveModel(dataDir: string, agentId: string): Promise<string>;
  summarize(input: { dataDir: string; model: string; agentId: string; subject: string; summaryInput: string;
    signal: AbortSignal; onChunk(chunk: string): void;
    onNotice?(notice: CompactionNotice): void | Promise<void> }): Promise<string>;
  apply(dataDir: string, workshopId: string, seat: SeatData, plan: ReadyPlan,
    summary: string, archivePath?: string, signal?: AbortSignal,
    progress?: CompactionProgress): Promise<{ archivedCount: number }>;
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
  return { prepare: input => trackCyclonePreparationStart(commands, async () => {
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
      let task: Promise<void> | undefined;
      let disposal: Promise<void> | undefined;
      return trackCyclonePreparation(commands, { execution,
        run: onEvent => {
          if (disposal) return Promise.reject(compactError('CYCLONE_COMPACTION_PREPARATION_CLOSED',
            'conflict', '压缩准备已结束，不能再次执行'));
          task ??= runCompaction(dataDir, input, seat, plan, model, execution,
            commands, executions, runtime, onEvent, changes);
          return task;
        },
        dispose: cause => {
          // Normal execution owns finish; transport cleanup must never submit its terminal twice.
          disposal ??= task ? task.then(() => undefined, () => undefined) : (async () => {
            await commands.finish({ operationId: execution.operationId, runId: execution.runId,
              status: cause === undefined ? 'aborted' : 'failed', agentIds: [],
              ...(cause === undefined ? {} : { error: errorMessage(cause) }) });
            changes?.publish(input.workshopId, 'activity', input.seatId);
          })();
          return disposal;
        },
      });
    } catch (error) {
      await commands.finish({ operationId: execution.operationId, runId: execution.runId,
        status: 'failed', error: errorMessage(error),
        ...(agentId ? { agentIds: [agentId] } : {}) });
      changes?.publish(input.workshopId, 'activity', input.seatId);
      throw error;
    }
  }) };
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
  const started = startCycloneCompaction();
  let failure: unknown;
  let committed = false;
  const notify = (event: unknown) => {
    try { onEvent?.(event); } catch (error) { console.warn('[cyclone] compaction observer failed', error); }
  };
  try {
    signal.throwIfAborted();
    seat.compaction = started;
    await saveSeat(dataDir, input.workshopId, seat);
    changes?.publish(input.workshopId, 'activity', input.seatId);
    notify(started);
    notify({ type: 'start', compressedCount: plan.archivedMessages.length, keptTurnCount: plan.keptTurnCount });
    const archivePath = await runtime.archive?.(dataDir, input.workshopId, seat, plan);
    const summary = await runtime.summarize({ dataDir, model, agentId: seat.agentId,
      subject: `工位「${seat.title}」私聊`, summaryInput: plan.summaryInput, signal,
      onChunk: content => notify({ type: 'token', content }),
      onNotice: async notice => {
        seat.compactionNotice = notice;
        await saveSeat(dataDir, input.workshopId, seat);
        notify(notice);
      } });
    signal.throwIfAborted();
    const done = finishCycloneCompaction(started);
    const result = await runtime.apply(dataDir, input.workshopId, seat, plan, summary, archivePath, signal, done);
    committed = true;
    changes?.publish(input.workshopId, 'activity', input.seatId);
    notify(done);
    notify({ type: 'done', archivedCount: result.archivedCount, keptTurnCount: plan.keptTurnCount });
  } catch (error) {
    failure = error;
    const failed = finishCycloneCompaction(started, error, signal.aborted);
    seat.compaction = failed;
    await saveSeat(dataDir, input.workshopId, seat)
      .catch(cause => console.warn('[cyclone] compaction failure feedback could not be saved', cause));
    notify(failed);
  }
  const status = committed ? 'completed' : signal.aborted ? 'aborted' : 'failed';
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
