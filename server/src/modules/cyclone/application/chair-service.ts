import { withCycloneSummaryUsage } from './summary-model-usage.js';
import { deleteContextMessage, editContextMessage } from '../../../engine/cyclone/message-mutations.js';
import { resetRoomContext, saveRoom, tryAcquireRoomLock } from '../../../engine/cyclone/room-store.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import type { CycloneRoomService } from './room-service.js';
import type { CycloneWorkshopService } from './workshop-service.js';
import {
  toCycloneSummaryMessages,
  type CycloneContextSummarizer,
} from '../domain/context-summary.js';
import type { CycloneChangeFeed } from './change-feed.js';
import { archiveCycloneCompaction } from '../../../engine/cyclone/compaction-archive.js';
import { buildCycloneChairContext, clearCycloneChairContext } from '../../../engine/cyclone/chair-context.js';
import { withCycloneContextChange } from './context-compaction-transaction.js';
import { finishCycloneCompaction } from '../../../engine/cyclone/compaction-progress.js';

export class CycloneChairService {
  constructor(
    private readonly dataDir: string,
    private readonly executions: CycloneExecutionPort,
    private readonly workshops: CycloneWorkshopService,
    private readonly rooms: CycloneRoomService,
    private readonly summarizer: CycloneContextSummarizer,
    private readonly changes?: CycloneChangeFeed,
  ) {}

  async status(workshopId: string, roomId: string) {
    const workshop = await this.workshops.require(workshopId);
    if (!workshop.chairAgentId) throw chairError(
      'CYCLONE_CHAIR_NOT_CONFIGURED', 'validation', '该工作室未指定会长',
    );
    const room = await this.rooms.require(workshopId, roomId);
    return { chairAgentId: workshop.chairAgentId, messages: room.chairMessages || [],
      tokenUsage: room.chairTokenUsage, modelUsage: room.chairModelUsage, compactionNotice: room.chairCompactionNotice, compaction: room.chairCompaction };
  }

  async editMessage(workshopId: string, roomId: string, index: number, content?: string) {
    return this.withLock(workshopId, roomId, async () => {
      const room = await this.rooms.require(workshopId, roomId);
      const messages = room.chairMessages || [];
      const changed = content === undefined
        ? deleteContextMessage(messages, index)
        : editContextMessage(messages, index, content);
      if (!changed) throw chairError(
        'CYCLONE_CHAIR_MESSAGE_INVALID', 'validation', '消息索引越界或内容无效',
      );
      room.chairMessages = messages;
      clearCycloneChairContext(room);
      room.chairTokenUsage = undefined;
      await saveRoom(this.dataDir, workshopId, room);
      this.changes?.publish(workshopId, 'activity', roomId);
      return { ok: true };
    });
  }

  async reset(workshopId: string, roomId: string, mode: 'clear' | 'summary', signal?: AbortSignal) {
    this.assertIdle(workshopId, roomId);
    return this.withLock(workshopId, roomId, async () => {
      const status = await this.status(workshopId, roomId);
      const room = await this.rooms.require(workshopId, roomId);
      return withCycloneContextChange(mode === 'summary' ? 'compact' : 'reset', signal,
        async progress => {
          const current = await this.rooms.require(workshopId, roomId);
          if (current.chairCompaction?.id === progress.id && current.chairCompaction.type === 'compact-done') return;
          current.chairCompaction = progress; room.chairCompaction = progress;
          await saveRoom(this.dataDir, workshopId, current);
          this.changes?.publish(workshopId, 'activity', roomId);
        }, async started => {
          const archivePath = mode === 'summary' ? await archiveCycloneCompaction(
            this.dataDir, workshopId, `chair-${roomId}`, { type: 'cyclone-chair-context-compact', roomId,
              messages: status.messages, chairMessages: status.messages, publicMessages: room.publicMessages,
              chairActiveContext: room.chairActiveContext, tokenUsage: room.chairTokenUsage }) : undefined;
          const chairSummary = mode === 'summary' ? await withCycloneSummaryUsage({
            get: () => room.chairModelUsage, set: value => { room.chairModelUsage = value; },
            persist: () => saveRoom(this.dataDir, workshopId, room),
            emit: () => this.changes?.publish(workshopId, 'activity', roomId),
          }, () => this.summarizer.summarize({
            agentId: status.chairAgentId, kind: 'meeting', signal, subject: `群聊「${room.title}」会长私聊`,
            messages: toCycloneSummaryMessages(buildCycloneChairContext(room, { role: 'system', content: '' }).slice(1)),
            onNotice: async notice => {
              room.chairCompactionNotice = notice;
              await saveRoom(this.dataDir, workshopId, room);
              this.changes?.publish(workshopId, 'activity', roomId);
            },
          })) : undefined;
          if (mode === 'summary' && !chairSummary?.trim()) throw new Error('压缩摘要为空，原会话保留');
          signal?.throwIfAborted();
          const result = await resetRoomContext(this.dataDir, workshopId, roomId, {
            scope: 'chair', chairSummary, preparedArchivePath: archivePath, signal,
            compaction: finishCycloneCompaction(started),
          });
          this.changes?.publish(workshopId, 'activity', roomId);
          return { ok: true, archivePath: result.archivePath,
            archivedChairCount: result.archivedChairCount, summary: mode === 'summary' };
        });
    });
  }

  private async withLock<T>(workshopId: string, roomId: string, action: () => Promise<T>): Promise<T> {
    const release = tryAcquireRoomLock(workshopId, roomId);
    if (!release) throw chairError('CYCLONE_CHAIR_BUSY', 'conflict', '会长正在处理中');
    try { return await action(); } finally { release(); }
  }

  private assertIdle(workshopId: string, roomId: string): void {
    const operationId = `room:${workshopId}:${roomId}`;
    if (this.executions.list().some(item => item.operationId === operationId)) {
      throw chairError('CYCLONE_CHAIR_BUSY', 'conflict', '会长正在处理中');
    }
  }
}

function chairError(
  code: string,
  kind: 'validation' | 'conflict',
  message: string,
) {
  return frameworkError({ code, kind, message, source: 'cyclone.chair', retryable: false });
}
