import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { deleteContextMessage, editContextMessage } from '../../../engine/cyclone/message-mutations.js';
import { deleteSeatFromWorkshop } from '../../../engine/cyclone/seat-lifecycle.js';
import { RoomSettingsConflictError } from '../../../engine/cyclone/room-store.js';
import {
  loadSeat,
  resetSeatContext,
  saveSeat,
  tryAcquireSeatLock,
  updateSeatRole,
} from '../../../engine/cyclone/seat-store.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import {
  toCycloneSummaryMessages,
  type CycloneContextSummarizer,
} from '../domain/context-summary.js';
import type { CycloneChangeFeed } from './change-feed.js';
import { archiveCycloneCompaction } from '../../../engine/cyclone/compaction-archive.js';

export interface SeatRolePatch {
  agentId?: string;
  title?: string;
  rolePrompt?: string;
  duty?: string;
  overrideAgentRole?: boolean;
}

export class CycloneSeatService {
  constructor(
    private readonly dataDir: string,
    private readonly executions: CycloneExecutionPort,
    private readonly summarizer: CycloneContextSummarizer,
    private readonly changes?: CycloneChangeFeed,
  ) {}

  async require(workshopId: string, seatId: string) {
    const seat = await loadSeat(this.dataDir, workshopId, seatId);
    if (!seat) throw seatError('CYCLONE_SEAT_NOT_FOUND', 'not_found', '工位不存在');
    return seat;
  }

  async revision(workshopId: string, seatId: string): Promise<{ updatedAt: string }> {
    return { updatedAt: (await this.require(workshopId, seatId)).updatedAt };
  }

  async updateRole(workshopId: string, seatId: string, patch: SeatRolePatch) {
    if (patch.agentId !== undefined && !await loadAgent(this.dataDir, patch.agentId)) {
      throw seatError('CYCLONE_SEAT_AGENT_NOT_FOUND', 'validation', '绑定的 Agent 不存在或已删除');
    }
    return this.withLock(workshopId, seatId, async () => {
      const updated = await updateSeatRole(this.dataDir, workshopId, seatId, patch);
      if (!updated) throw seatError('CYCLONE_SEAT_NOT_FOUND', 'not_found', '工位不存在');
      this.changes?.publish(workshopId, 'workshop', workshopId);
      return updated;
    });
  }

  async editMessage(workshopId: string, seatId: string, index: number, content?: string) {
    return this.withLock(workshopId, seatId, async () => {
      const seat = await this.require(workshopId, seatId);
      if (seat.pending) throw seatError(
        'CYCLONE_SEAT_PENDING', 'conflict', '该工位存在挂起提问，请先完成回答再修改历史',
      );
      const changed = content === undefined
        ? deleteContextMessage(seat.messages, index)
        : editContextMessage(seat.messages, index, content);
      if (!changed) throw seatError(
        'CYCLONE_SEAT_MESSAGE_INVALID', 'validation', '消息索引越界或内容无效',
      );
      await saveSeat(this.dataDir, workshopId, seat);
      this.changes?.publish(workshopId, 'activity', seatId);
      return { ok: true };
    });
  }

  async reset(
    workshopId: string,
    seatId: string,
    options: { mode: 'clear' | 'summary'; forcePending?: boolean },
  ) {
    this.assertIdle(workshopId, seatId);
    return this.withLock(workshopId, seatId, async () => {
      const seat = await this.require(workshopId, seatId);
      if (seat.pending && !options.forcePending) throw seatError(
        'CYCLONE_SEAT_PENDING', 'conflict', '该工位存在挂起提问，请先完成回答',
      );
      const archivePath = options.mode === 'summary' ? await archiveCycloneCompaction(
        this.dataDir, workshopId, `seat-${seatId}`, { type: 'cyclone-seat-context-compact',
          seatId, messages: seat.messages, pending: seat.pending, tokenUsage: seat.tokenUsage },
      ) : undefined;
      const summary = options.mode === 'summary' ? await this.summarizer.summarize({
        agentId: seat.agentId,
        subject: `工位「${seat.title}」私聊`,
        messages: toCycloneSummaryMessages(seat.messages || []),
        onNotice: async notice => {
          seat.compactionNotice = notice;
          await saveSeat(this.dataDir, workshopId, seat);
          this.changes?.publish(workshopId, 'activity', seatId);
        },
      }) : undefined;
      const result = await resetSeatContext(this.dataDir, workshopId, seatId, {
        summary, forcePending: options.forcePending, preparedArchivePath: archivePath,
      });
      this.changes?.publish(workshopId, 'activity', seatId);
      return { ok: true, archivePath: result.archivePath, archivedCount: result.archivedCount,
        summary: options.mode === 'summary' };
    });
  }

  async remove(workshopId: string, seatId: string): Promise<{ ok: true }> {
    this.assertIdle(workshopId, seatId);
    try {
      await deleteSeatFromWorkshop(this.dataDir, workshopId, seatId);
      this.changes?.publish(workshopId, 'workshop', workshopId);
    } catch (error) {
      if (!(error instanceof RoomSettingsConflictError)) throw error;
      throw seatError('CYCLONE_SEAT_DELETE_CONFLICT', 'conflict', error.message);
    }
    return { ok: true };
  }

  private assertIdle(workshopId: string, seatId: string): void {
    const operationId = `seat:${workshopId}:${seatId}`;
    if (this.executions.list().some(item => item.operationId === operationId)) {
      throw seatError('CYCLONE_SEAT_BUSY', 'conflict', '该工位正在处理中');
    }
  }

  private async withLock<T>(workshopId: string, seatId: string, action: () => Promise<T>): Promise<T> {
    const release = tryAcquireSeatLock(workshopId, seatId);
    if (!release) throw seatError('CYCLONE_SEAT_BUSY', 'conflict', '该工位正在处理中');
    try { return await action(); } finally { release(); }
  }
}

function seatError(
  code: string,
  kind: 'validation' | 'not_found' | 'conflict',
  message: string,
) {
  return frameworkError({ code, kind, message, source: 'cyclone.seats', retryable: false });
}
