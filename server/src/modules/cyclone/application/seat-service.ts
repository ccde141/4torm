import { withCycloneSummaryUsage } from './summary-model-usage.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { deleteContextMessage, editContextMessage } from '../../../engine/cyclone/message-mutations.js';
import { deleteSeatFromWorkshop } from '../../../engine/cyclone/seat-lifecycle.js';
import { loadRoom, RoomSettingsConflictError, tryAcquireRoomLock } from '../../../engine/cyclone/room-store.js';
import { loadWorkshop } from '../../../engine/cyclone/workshop-store.js';
import {
  loadSeat,
  listLockedSeatIds,
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
import type { SeatCollaborationPolicy } from '../../../engine/cyclone/seat-collaboration.js';
import { withCycloneContextChange } from './context-compaction-transaction.js';
import { finishCycloneCompaction, recoveredCycloneCompaction } from '../../../engine/cyclone/compaction-progress.js';
import { appendSeatConfigurationHistory, type SeatHistorySource } from '../../../engine/cyclone/seat-history.js';

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
    seat.compaction = recoveredCycloneCompaction(seat.compaction, listLockedSeatIds(workshopId).includes(seatId));
    return seat;
  }

  async revision(workshopId: string, seatId: string): Promise<{ updatedAt: string }> {
    return { updatedAt: (await this.require(workshopId, seatId)).updatedAt };
  }

  async updateRole(workshopId: string, seatId: string, patch: SeatRolePatch, source: SeatHistorySource = 'human') {
    if (patch.agentId !== undefined && !await loadAgent(this.dataDir, patch.agentId)) {
      throw seatError('CYCLONE_SEAT_AGENT_NOT_FOUND', 'validation', '绑定的 Agent 不存在或已删除');
    }
    return this.withConfigLock(workshopId, seatId, async () => {
      const updated = await updateSeatRole(this.dataDir, workshopId, seatId, patch, source);
      if (!updated) throw seatError('CYCLONE_SEAT_NOT_FOUND', 'not_found', '工位不存在');
      this.changes?.publish(workshopId, 'workshop', workshopId);
      return updated;
    });
  }

  async updateCollaboration(
    workshopId: string, seatId: string, policy: SeatCollaborationPolicy, source: SeatHistorySource = 'human',
  ): Promise<SeatCollaborationPolicy> {
    return this.withConfigLock(workshopId, seatId, async () => {
      const seat = await this.require(workshopId, seatId);
      const previous = { ...seat, collaboration: seat.collaboration && { ...seat.collaboration } };
      seat.collaboration = { ...policy };
      appendSeatConfigurationHistory(workshopId, previous, seat, source);
      await saveSeat(this.dataDir, workshopId, seat);
      this.changes?.publish(workshopId, 'workshop', workshopId);
      return { ...seat.collaboration };
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

  async reset(workshopId: string, seatId: string,
    options: { mode: 'clear' | 'summary'; forcePending?: boolean }, signal?: AbortSignal) {
    this.assertIdle(workshopId, seatId);
    return this.withLock(workshopId, seatId, async () => {
      const seat = await this.require(workshopId, seatId);
      if (seat.pending && !options.forcePending) throw seatError(
        'CYCLONE_SEAT_PENDING', 'conflict', '该工位存在挂起提问，请先完成回答');
      return withCycloneContextChange(options.mode === 'summary' ? 'compact' : 'reset', signal,
        async progress => {
          const current = await this.require(workshopId, seatId);
          if (current.compaction?.id === progress.id && current.compaction.type === 'compact-done') return;
          current.compaction = progress;
          await saveSeat(this.dataDir, workshopId, current);
          seat.compaction = progress;
          this.changes?.publish(workshopId, 'activity', seatId);
        }, async started => {
          const archivePath = options.mode === 'summary' ? await archiveCycloneCompaction(
            this.dataDir, workshopId, `seat-${seatId}`, { type: 'cyclone-seat-context-compact',
              seatId, messages: seat.messages, pending: seat.pending, tokenUsage: seat.tokenUsage }) : undefined;
          const summary = options.mode === 'summary' ? await withCycloneSummaryUsage({
            get: () => seat.modelUsage, set: value => { seat.modelUsage = value; },
            persist: () => saveSeat(this.dataDir, workshopId, seat),
            emit: () => this.changes?.publish(workshopId, 'activity', seatId),
          }, () => this.summarizer.summarize({
            agentId: seat.agentId, signal, subject: `工位「${seat.title}」私聊`,
            messages: toCycloneSummaryMessages(seat.messages || []),
            onNotice: async notice => {
              seat.compactionNotice = notice;
              await saveSeat(this.dataDir, workshopId, seat);
              this.changes?.publish(workshopId, 'activity', seatId);
            },
          })) : undefined;
          if (options.mode === 'summary' && !summary?.trim()) throw new Error('压缩摘要为空，原会话保留');
          signal?.throwIfAborted();
          const result = await resetSeatContext(this.dataDir, workshopId, seatId, {
            summary, forcePending: options.forcePending, preparedArchivePath: archivePath, signal,
            compaction: finishCycloneCompaction(started),
          });
          this.changes?.publish(workshopId, 'activity', seatId);
          return { ok: true, archivePath: result.archivePath, archivedCount: result.archivedCount,
            summary: options.mode === 'summary' };
        });
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

  private async withConfigLock<T>(workshopId: string, seatId: string, action: () => Promise<T>): Promise<T> {
    this.assertIdle(workshopId, seatId);
    return this.withLock(workshopId, seatId, async () => {
      const releases: Array<() => void> = [];
      try {
        // 群聊副本会保存岗位公告水位；角色和协作设置共用冲突门，防旧副本覆盖新配置。
        const workshop = await loadWorkshop(this.dataDir, workshopId);
        for (const roomId of workshop?.roomIds ?? []) {
          const room = await loadRoom(this.dataDir, workshopId, roomId);
          if (!room?.participantSeatIds.includes(seatId)) continue;
          const release = tryAcquireRoomLock(workshopId, roomId);
          if (!release) throw seatError('CYCLONE_SEAT_BUSY', 'conflict', '该工位正在参与会议，暂不能修改配置');
          releases.push(release);
        }
        return await action();
      } finally { releases.reverse().forEach(release => release()); }
    });
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
