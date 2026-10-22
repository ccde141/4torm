import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { RoomMode } from '../../../engine/cyclone/types.js';
import type { ResolvedOutputBudget } from '../../../engine/collaboration/contracts.js';
import type { CycloneRoomService } from './room-service.js';
import type { CycloneWorkshopService } from './workshop-service.js';
import type { CycloneSupervisorService } from './supervisor-service.js';
import type { CycloneSupervisorSummary } from '../domain/supervisor-view.js';

export interface CollaborationGroupMember {
  agentId: string;
  title: string;
  rolePrompt?: string;
  duty?: string;
  overrideAgentRole?: boolean;
}

export interface CreateCollaborationGroupInput {
  title: string;
  chairAgentId?: string;
  supervisorAgentId?: string;
  supervisorRolePrompt?: string;
  members: CollaborationGroupMember[];
  room: { title: string; topic: string; mode?: RoomMode };
}

export interface CollaborationGroupResult {
  workshopId: string;
  title: string;
  chairAgentId?: string;
  supervisor?: CycloneSupervisorSummary;
  seats: Array<{ seatId: string; agentId: string; title: string }>;
  room: { roomId: string; title: string; topic: string; mode: RoomMode };
}

export interface CollaborationGroupView {
  workshopId: string;
  title: string;
  chairAgentId?: string;
  supervisor?: CycloneSupervisorSummary;
  seats: Array<{ id: string; agentId: string; title: string; duty?: string; pending: boolean }>;
  rooms: Array<{
    id: string; title: string; topic: string; mode: RoomMode; participantSeatIds: string[];
  }>;
  messages: CollaborationGroupMessage[];
  truncated: boolean;
}

interface CollaborationGroupMessage {
  roomId: string;
  roomTitle: string;
  speaker: string;
  content: string;
  timestamp: number;
}

export class CycloneCollaborationService {
  constructor(
    private readonly dataDir: string,
    private readonly workshops: CycloneWorkshopService,
    private readonly rooms: CycloneRoomService,
    private readonly supervisor?: Pick<CycloneSupervisorService, 'configureInitial' | 'summary'>,
  ) {}

  async create(input: CreateCollaborationGroupInput): Promise<CollaborationGroupResult> {
    await this.preflight(input);
    const draft = await this.workshops.createDraft({
      title: input.title, chairAgentId: input.chairAgentId,
    });
    try {
      const seats = [];
      for (const member of input.members) {
        const seat = await this.workshops.addSeat({ workshopId: draft.id, ...member }, false);
        seats.push({ seatId: seat.id, agentId: seat.agentId, title: seat.title });
      }
      const room = await this.rooms.create({
        workshopId: draft.id, ...input.room,
        participantSeatIds: seats.map(seat => seat.seatId),
      }, false);
      if (input.supervisorAgentId) await this.supervisor!.configureInitial(draft.id, {
        agentId: input.supervisorAgentId, rolePrompt: input.supervisorRolePrompt ?? '',
      });
      const supervisor = this.supervisor ? await this.supervisor.summary(draft.id) : undefined;
      await this.workshops.publish(draft.id);
      return {
        workshopId: draft.id, title: draft.title, chairAgentId: draft.chairAgentId,
        ...(supervisor ? { supervisor } : {}),
        seats, room: {
          roomId: room.id, title: room.title, topic: room.topic, mode: room.mode ?? 'build',
        },
      };
    } catch (error) {
      return this.rollback(draft.id, error);
    }
  }

  async read(workshopId: string, budget: ResolvedOutputBudget): Promise<CollaborationGroupView> {
    const summary = await this.workshops.summary(workshopId);
    const rooms = await Promise.all(summary.rooms.map(room => this.rooms.require(workshopId, room.id)));
    const messages = rooms.flatMap(room => room.publicMessages.map(message => ({
      roomId: room.id, roomTitle: room.title, speaker: message.speaker,
      content: message.content, timestamp: message.timestamp,
    }))).sort((left, right) => left.timestamp - right.timestamp);
    const selected = messages.slice(-(budget.items ?? 20));
    const bounded = boundMessages(selected, budget.textChars ?? 8_000, budget.textLines ?? 160);
    return {
      workshopId: summary.id, title: summary.title, chairAgentId: summary.chairAgentId,
      ...(this.supervisor ? { supervisor: await this.supervisor.summary(workshopId) } : {}),
      seats: summary.seats, rooms: rooms.map(room => ({
        id: room.id, title: room.title, topic: room.topic, mode: room.mode ?? 'build',
        participantSeatIds: [...room.participantSeatIds],
      })),
      messages: bounded.messages,
      truncated: messages.length > selected.length || bounded.truncated,
    };
  }

  private async preflight(input: CreateCollaborationGroupInput): Promise<void> {
    if (input.supervisorAgentId && !this.supervisor) throw groupError(
      'CYCLONE_GROUP_SUPERVISOR_UNAVAILABLE', 'validation', '主管配置服务尚未就绪');
    const titles = new Set<string>();
    for (const member of input.members) {
      if (titles.has(member.title)) throw groupError(
        'CYCLONE_GROUP_MEMBER_DUPLICATE', 'validation', '协作组工位名称不能重复',
      );
      titles.add(member.title);
    }
    const agentIds = new Set(input.members.map(member => member.agentId));
    if (input.chairAgentId) agentIds.add(input.chairAgentId);
    if (input.supervisorAgentId) agentIds.add(input.supervisorAgentId);
    for (const agentId of agentIds) {
      if (!await loadAgent(this.dataDir, agentId)) throw groupError(
        'CYCLONE_GROUP_AGENT_NOT_FOUND', 'validation', '协作组引用的 Agent 不存在', { agentId },
      );
    }
  }

  private async rollback(workshopId: string, original: unknown): Promise<never> {
    try {
      await this.workshops.discard(workshopId);
    } catch (rollback) {
      throw groupError(
        'CYCLONE_GROUP_ROLLBACK_FAILED', 'io', '协作组创建失败，且半成品清理失败',
        { workshopId, original: errorMessage(original), rollback: errorMessage(rollback) },
        rollback,
      );
    }
    throw original;
  }
}

function boundMessages(
  messages: CollaborationGroupMessage[], maxChars: number, maxLines: number,
): { messages: CollaborationGroupMessage[]; truncated: boolean } {
  let chars = 0;
  let lines = 0;
  const result: CollaborationGroupMessage[] = [];
  for (const message of [...messages].reverse()) {
    const nextLines = message.content.split('\n').length;
    if (chars + message.content.length > maxChars || lines + nextLines > maxLines) {
      return { messages: result.reverse(), truncated: true };
    }
    result.push(message);
    chars += message.content.length;
    lines += nextLines;
  }
  return { messages: result.reverse(), truncated: false };
}

function groupError(
  code: string,
  kind: 'validation' | 'io',
  message: string,
  details?: Record<string, unknown>,
  cause?: unknown,
) {
  return frameworkError({
    code, kind, message, source: 'cyclone.collaborations', retryable: false, details,
  }, cause === undefined ? undefined : { cause });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
