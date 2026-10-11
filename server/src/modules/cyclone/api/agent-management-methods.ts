import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  AgentRoomInput, AgentSeatInput,
  CycloneAgentManagementService,
} from '../application/agent-management-service.js';

const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
const text = { type: 'string', minLength: 1, maxLength: 2_000 };
const seatIds = { type: 'array', maxItems: 50, uniqueItems: true, items: id };

export function cycloneAgentManagementManifests(): ModuleMethodManifest[] {
  return [
    method('addCollaborationSeat', 'add_collaboration_seat',
      '在已有气旋工作室新增工位，绑定已存在的全局 Agent；不会重绑旧工位。',
      ['workshopId', 'agentId', 'title'], {
        workshopId: id, agentId: id, title: text, rolePrompt: text, duty: text,
        overrideAgentRole: { type: 'boolean' },
      }),
    method('createCollaborationRoom', 'create_collaboration_room',
      '在工作室新建群聊；可选择已有工位，任何无效工位都会使建房失败。',
      ['workshopId', 'title', 'topic'], {
        workshopId: id, title: text, topic: text, participantSeatIds: seatIds,
        mode: { type: 'string', enum: ['build', 'plan'] },
      }),
    method('joinCollaborationRoom', 'join_collaboration_room',
      '将已有工位加入已有群聊。', ['workshopId', 'roomId', 'seatId'],
      { workshopId: id, roomId: id, seatId: id }),
    method('leaveCollaborationRoom', 'leave_collaboration_room',
      '让工位退出群聊，保留工位、群聊及其历史。', ['workshopId', 'roomId', 'seatId'],
      { workshopId: id, roomId: id, seatId: id }),
  ];
}

export function cycloneAgentManagementHandlers(
  service: CycloneAgentManagementService,
): Record<string, ModuleMethodHandler> {
  return {
    addCollaborationSeat: handler(parseSeat, input => service.addSeat(input)),
    createCollaborationRoom: handler(parseRoom, input => service.createRoom(input)),
    joinCollaborationRoom: handler(parseMembership, input => service.join(
      input.workshopId, input.roomId, input.seatId)),
    leaveCollaborationRoom: handler(parseMembership, input => service.leave(
      input.workshopId, input.roomId, input.seatId)),
  };
}

function method(id: string, name: string, description: string, required: string[],
  properties: Record<string, unknown>): ModuleMethodManifest {
  return { id, kind: 'command', permission: 'design', audiences: ['agent', 'internal'],
    agentTool: { name, description },
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    output: { mode: 'inline', budget: { textChars: { default: 3_000, max: 5_000 } } } };
}

function handler<T>(parse: (value: unknown) => T,
  invoke: (value: T) => Promise<unknown>): ModuleMethodHandler {
  return { parse, invoke: async (_context, input) => invoke(input as T) };
}

function parseSeat(value: unknown): AgentSeatInput {
  const item = exact(value, ['workshopId', 'agentId', 'title', 'rolePrompt',
    'duty', 'overrideAgentRole']);
  return { workshopId: identifier(item.workshopId), agentId: identifier(item.agentId),
    title: label(item.title),
    ...(item.rolePrompt === undefined ? {} : { rolePrompt: label(item.rolePrompt) }),
    ...(item.duty === undefined ? {} : { duty: label(item.duty) }),
    ...(item.overrideAgentRole === undefined ? {} : {
      overrideAgentRole: boolean(item.overrideAgentRole),
    }) };
}

function parseRoom(value: unknown): AgentRoomInput {
  const item = exact(value, ['workshopId', 'title', 'topic', 'participantSeatIds', 'mode']);
  return { workshopId: identifier(item.workshopId), title: label(item.title),
    topic: label(item.topic), participantSeatIds: item.participantSeatIds === undefined
      ? [] : identifiers(item.participantSeatIds),
    ...(item.mode === undefined ? {} : { mode: roomMode(item.mode) }) };
}

function parseMembership(value: unknown) {
  const item = exact(value, ['workshopId', 'roomId', 'seatId']);
  return { workshopId: identifier(item.workshopId), roomId: identifier(item.roomId),
    seatId: identifier(item.seatId) };
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalid();
  }
  return value;
}

function identifiers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw invalid();
  const ids = value.map(identifier);
  if (new Set(ids).size !== ids.length) throw invalid();
  return ids;
}

function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) throw invalid();
  return value.trim();
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalid();
  return value;
}

function roomMode(value: unknown): 'build' | 'plan' {
  if (value !== 'build' && value !== 'plan') throw invalid();
  return value;
}

function invalid() {
  return frameworkError({ code: 'CYCLONE_AGENT_MANAGEMENT_INPUT_INVALID',
    kind: 'validation', message: '气旋日常管理参数无效',
    source: 'cyclone.agent-management', retryable: false });
}
