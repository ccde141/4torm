import fs from 'node:fs/promises';
import { loadSeat } from '../../../engine/cyclone/seat-store.js';
import type { RoomData, RoomMode } from '../../../engine/cyclone/types.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { CycloneRoomService } from './room-service.js';
import type { CycloneWorkshopService } from './workshop-service.js';
import type { CycloneChangeFeed } from './change-feed.js';

export interface AgentSeatInput {
  workshopId: string;
  agentId: string;
  title: string;
  rolePrompt?: string;
  duty?: string;
  overrideAgentRole?: boolean;
}

export interface AgentRoomInput {
  workshopId: string;
  title: string;
  topic: string;
  participantSeatIds: string[];
  mode?: RoomMode;
}

export class CycloneAgentManagementService {
  constructor(
    private readonly dataDir: string,
    private readonly workshops: CycloneWorkshopService,
    private readonly rooms: CycloneRoomService,
    private readonly changes?: CycloneChangeFeed,
  ) {}

  async addSeat(input: AgentSeatInput) {
    await this.requireAgent(input.agentId);
    const seat = await this.workshops.addSeat(input);
    return { seatId: seat.id, agentId: seat.agentId, title: seat.title,
      rolePrompt: seat.rolePrompt, duty: seat.duty,
      overrideAgentRole: seat.overrideAgentRole ?? false };
  }

  async createRoom(input: AgentRoomInput) {
    await this.requireSeats(input.workshopId, input.participantSeatIds);
    const room = await this.rooms.create(input, false);
    if (room.participantSeatIds.length !== input.participantSeatIds.length
      || room.participantSeatIds.some((seatId, index) => seatId !== input.participantSeatIds[index])) {
      try { await this.rooms.remove(input.workshopId, room.id); }
      catch (cause) {
        throw manageError('CYCLONE_ROOM_CREATE_ROLLBACK_FAILED', 'io',
          '群聊成员写入不完整，且半成品清理失败', cause);
      }
      throw manageError('CYCLONE_ROOM_CREATE_INCOMPLETE', 'conflict',
        '群聊创建期间工位发生变化，请重新确认名单');
    }
    this.changes?.publish(input.workshopId, 'room', room.id);
    return roomView(room);
  }

  async join(workshopId: string, roomId: string, seatId: string) {
    await this.requireSeats(workshopId, [seatId]);
    return roomView(await this.rooms.join(workshopId, roomId, seatId));
  }

  async leave(workshopId: string, roomId: string, seatId: string) {
    return roomView(await this.rooms.leave(workshopId, roomId, seatId));
  }

  private async requireAgent(agentId: string): Promise<void> {
    let raw: string;
    try { raw = await fs.readFile(agentRegistryFile(this.dataDir), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw manageError('CYCLONE_AGENT_NOT_FOUND', 'not_found', 'Agent 不存在');
      }
      throw error;
    }
    let registry: unknown;
    try { registry = JSON.parse(raw); }
    catch (error) {
      throw manageError('CYCLONE_AGENT_REGISTRY_INVALID', 'io', 'Agent 注册表已损坏', error);
    }
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
      throw manageError('CYCLONE_AGENT_REGISTRY_INVALID', 'io', 'Agent 注册表已损坏');
    }
    if (!Object.hasOwn(registry, agentId)) {
      throw manageError('CYCLONE_AGENT_NOT_FOUND', 'not_found', 'Agent 不存在');
    }
    const entry = (registry as Record<string, unknown>)[agentId];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw manageError('CYCLONE_AGENT_NOT_FOUND', 'not_found', 'Agent 不存在');
    }
  }

  private async requireSeats(workshopId: string, seatIds: string[]): Promise<void> {
    if (new Set(seatIds).size !== seatIds.length) {
      throw manageError('CYCLONE_ROOM_ROSTER_INVALID', 'validation', '工位名单不能重复');
    }
    const workshop = await this.workshops.require(workshopId);
    for (const seatId of seatIds) {
      if (workshop.seatIds.includes(seatId) && await loadSeat(this.dataDir, workshopId, seatId)) {
        continue;
      }
      throw manageError('CYCLONE_ROOM_SEAT_NOT_FOUND', 'validation',
        `工位不存在：${seatId}`);
    }
  }
}

function roomView(room: RoomData | null) {
  if (!room) throw manageError('CYCLONE_ROOM_NOT_FOUND', 'not_found', '群聊不存在');
  return { roomId: room.id, title: room.title, topic: room.topic,
    mode: room.mode ?? 'build', participantSeatIds: [...room.participantSeatIds],
    updatedAt: room.updatedAt };
}

function manageError(code: string, kind: 'validation' | 'not_found' | 'io' | 'conflict',
  message: string, cause?: unknown) {
  return frameworkError({ code, kind, message, source: 'cyclone.agent-management',
    retryable: false }, cause === undefined ? undefined : { cause });
}
