import { frameworkError } from '../../../engine/shared/framework-error.js';
import {
  createRoom,
  deleteRoom,
  joinRoom,
  leaveRoom,
  loadRoom,
  renameRoom,
  resetRoomContext,
  RoomDeleteConflictError,
  RoomSettingsConflictError,
  saveRoom,
  setRoomMode,
  setRoomParticipants,
  setRoomTopic,
  tryAcquireRoomLock,
} from '../../../engine/cyclone/room-store.js';
import type { RoomData, RoomMessage, RoomMode } from '../../../engine/cyclone/types.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import {
  toCycloneSummaryMessages,
  type CycloneContextSummarizer,
} from '../domain/context-summary.js';
import type { CycloneWorkshopService } from './workshop-service.js';
import type { CycloneChangeFeed } from './change-feed.js';
import { archiveCycloneCompaction } from '../../../engine/cyclone/compaction-archive.js';
import { buildCycloneChairContext, clearCycloneChairContext } from '../../../engine/cyclone/chair-context.js';

export interface CreateRoomInput {
  workshopId: string;
  title?: string;
  topic?: string;
  participantSeatIds?: string[];
  mode?: RoomMode;
}

export interface ExpectedRoomMessage {
  id?: string;
  timestamp: number;
  speaker: string;
  content: string;
}

export class CycloneRoomService {
  constructor(
    private readonly dataDir: string,
    private readonly executions: CycloneExecutionPort,
    private readonly workshops: CycloneWorkshopService,
    private readonly summarizer: CycloneContextSummarizer,
    private readonly changes?: CycloneChangeFeed,
  ) {}

  async require(workshopId: string, roomId: string): Promise<RoomData> {
    const room = await loadRoom(this.dataDir, workshopId, roomId);
    if (!room) throw roomError('CYCLONE_ROOM_NOT_FOUND', 'not_found', '群聊不存在');
    return room;
  }

  async create(input: CreateRoomInput, notify = true) {
    await this.workshops.require(input.workshopId);
    const { workshopId, ...options } = input;
    const room = await createRoom(this.dataDir, workshopId, options);
    if (notify) this.changes?.publish(workshopId, 'room', room.id);
    return room;
  }

  join(workshopId: string, roomId: string, seatId: string) {
    return this.settings(workshopId, roomId, () => joinRoom(this.dataDir, workshopId, roomId, seatId));
  }

  leave(workshopId: string, roomId: string, seatId: string) {
    return this.settings(workshopId, roomId, () => leaveRoom(this.dataDir, workshopId, roomId, seatId));
  }

  participants(workshopId: string, roomId: string, seatIds: string[]) {
    return this.settings(workshopId, roomId, () => (
      setRoomParticipants(this.dataDir, workshopId, roomId, seatIds)
    ));
  }

  rename(workshopId: string, roomId: string, title: string) {
    return this.settings(workshopId, roomId, () => renameRoom(this.dataDir, workshopId, roomId, title));
  }

  topic(workshopId: string, roomId: string, topic: string) {
    return this.settings(workshopId, roomId, () => setRoomTopic(this.dataDir, workshopId, roomId, topic));
  }

  mode(workshopId: string, roomId: string, mode: RoomMode) {
    return this.settings(workshopId, roomId, () => setRoomMode(this.dataDir, workshopId, roomId, mode));
  }

  async editMessage(
    workshopId: string, roomId: string, index: number, content?: string,
    expectedMessage?: ExpectedRoomMessage,
  ) {
    return this.withLock(workshopId, roomId, async () => {
      const room = await this.require(workshopId, roomId);
      const message = room.publicMessages[index];
      if (!message) {
        if (expectedMessage) throw messageConflict();
        throw roomError('CYCLONE_ROOM_MESSAGE_INVALID', 'validation', '消息索引越界');
      }
      if (expectedMessage && !matchesExpectedMessage(room.publicMessages, message, expectedMessage)) {
        throw messageConflict();
      }
      if (content === undefined) room.publicMessages.splice(index, 1);
      else { message.content = content; message.rawContent = undefined; }
      clearCycloneChairContext(room);
      room.chairTokenUsage = undefined;
      await saveRoom(this.dataDir, workshopId, room);
      this.changes?.publish(workshopId, 'activity', roomId);
      return { ok: true };
    });
  }

  async reset(
    workshopId: string,
    roomId: string,
    options: { mode: 'clear' | 'summary'; scope: 'public' | 'chair' | 'both' },
  ) {
    this.assertIdle(workshopId, roomId);
    return this.withLock(workshopId, roomId, async () => {
      const room = await this.require(workshopId, roomId);
      const archivePath = options.mode === 'summary' ? await archiveCycloneCompaction(
        this.dataDir, workshopId, `room-${roomId}`, { type: 'cyclone-room-context-compact',
          roomId, scope: options.scope, publicMessages: room.publicMessages,
          chairMessages: room.chairMessages, chairActiveContext: room.chairActiveContext,
          dispatchContextVersion: room.dispatchContextVersion },
      ) : undefined;
      const summaries = options.mode === 'summary'
        ? await this.summarizeReset(workshopId, room, options.scope) : {};
      const result = await resetRoomContext(this.dataDir, workshopId, roomId, {
        scope: options.scope, ...summaries, preparedArchivePath: archivePath,
      });
      this.changes?.publish(workshopId, 'activity', roomId);
      return { ok: true, archivePath: result.archivePath,
        archivedPublicCount: result.archivedPublicCount,
        archivedChairCount: result.archivedChairCount };
    });
  }

  private async summarizeReset(
    workshopId: string,
    room: RoomData,
    scope: 'public' | 'chair' | 'both',
  ): Promise<{ publicSummary?: string; chairSummary?: string }> {
    const chairId = (await this.workshops.require(workshopId)).chairAgentId;
    if (!chairId) throw roomError(
      'CYCLONE_ROOM_CHAIR_REQUIRED', 'validation', '摘要重置需要先设置会长 Agent',
    );
    const publicSummary = scope === 'public' || scope === 'both'
      ? await this.summarizer.summarize({ agentId: chairId,
        kind: 'meeting', onNotice: async notice => {
          room.compactionNotice = notice;
          await saveRoom(this.dataDir, workshopId, room);
          this.changes?.publish(workshopId, 'activity', room.id);
        },
        subject: `群聊「${room.title}」公共上下文`,
        messages: toCycloneSummaryMessages(room.publicMessages || []) })
      : undefined;
    const chairSummary = (scope === 'chair' || scope === 'both')
      && (room.chairMessages?.length || room.publicMessages.length)
      ? await this.summarizer.summarize({ agentId: chairId,
        kind: 'meeting', onNotice: async notice => {
          room.chairCompactionNotice = notice;
          await saveRoom(this.dataDir, workshopId, room);
          this.changes?.publish(workshopId, 'activity', room.id);
        },
        subject: `群聊「${room.title}」会长私聊`,
        messages: toCycloneSummaryMessages(buildCycloneChairContext(room,
          { role: 'system', content: '' }).slice(1)) })
      : undefined;
    return { publicSummary, chairSummary };
  }

  async remove(workshopId: string, roomId: string): Promise<{ ok: true }> {
    this.assertIdle(workshopId, roomId);
    try {
      if (!await deleteRoom(this.dataDir, workshopId, roomId)) {
        throw roomError('CYCLONE_ROOM_NOT_FOUND', 'not_found', '群聊不存在');
      }
    } catch (error) {
      if (!(error instanceof RoomDeleteConflictError)) throw error;
      throw roomError('CYCLONE_ROOM_DELETE_CONFLICT', 'conflict', error.message);
    }
    this.changes?.publish(workshopId, 'room', roomId);
    return { ok: true };
  }

  private async settings(
    workshopId: string,
    roomId: string,
    action: () => Promise<RoomData | null>,
  ): Promise<RoomData> {
    try {
      const room = await action();
      if (!room) throw roomError('CYCLONE_ROOM_NOT_FOUND', 'not_found', '群聊不存在');
      this.changes?.publish(workshopId, 'room', roomId);
      return room;
    } catch (error) {
      if (error instanceof RoomSettingsConflictError) {
        throw roomError('CYCLONE_ROOM_BUSY', 'conflict', error.message);
      }
      if (error instanceof Error && error.message.startsWith('工位不存在')) {
        throw roomError('CYCLONE_ROOM_SEAT_NOT_FOUND', 'validation', error.message);
      }
      throw error;
    }
  }

  private async withLock<T>(workshopId: string, roomId: string, action: () => Promise<T>): Promise<T> {
    const release = tryAcquireRoomLock(workshopId, roomId);
    if (!release) throw roomError('CYCLONE_ROOM_BUSY', 'conflict', '群聊正在处理中');
    try { return await action(); } finally { release(); }
  }

  private assertIdle(workshopId: string, roomId: string): void {
    const operationId = `room:${workshopId}:${roomId}`;
    if (this.executions.list().some(item => item.operationId === operationId)) {
      throw roomError('CYCLONE_ROOM_BUSY', 'conflict', '该群聊或会长私聊正在处理中');
    }
  }
}

function matchesExpectedMessage(
  messages: RoomMessage[], message: RoomMessage, expected: ExpectedRoomMessage,
): boolean {
  if (expected.id !== undefined && message.id !== expected.id) return false;
  if (message.timestamp !== expected.timestamp || message.speaker !== expected.speaker
    || message.content !== expected.content) return false;
  const matches = messages.filter(candidate => expected.id !== undefined
    ? candidate.id === expected.id
    : candidate.timestamp === expected.timestamp && candidate.speaker === expected.speaker
      && candidate.content === expected.content);
  return matches.length === 1;
}

function messageConflict() {
  return roomError('CYCLONE_ROOM_MESSAGE_CONFLICT', 'conflict', '消息已变化，请刷新后重试');
}

function roomError(
  code: string,
  kind: 'validation' | 'not_found' | 'conflict',
  message: string,
) {
  return frameworkError({ code, kind, message, source: 'cyclone.rooms', retryable: false });
}
