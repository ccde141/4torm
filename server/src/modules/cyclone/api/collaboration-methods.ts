import type {
  ModuleMethodHandler,
  ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  CollaborationGroupMember,
  CreateCollaborationGroupInput,
  CycloneCollaborationService,
} from '../application/collaboration-service.js';
import type { CycloneCollaborationRoundService } from '../application/collaboration-round.js';

const textSchema = { type: 'string', minLength: 1, maxLength: 2_000 };
const idSchema = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };

export function cycloneCollaborationManifests(includeRound = false): ModuleMethodManifest[] {
  const methods: ModuleMethodManifest[] = [{
    id: 'createCollaborationGroup', kind: 'command', permission: 'design',
    audiences: ['human', 'agent', 'internal'],
    agentTool: {
      name: 'create_collaboration_group',
      description: '创建一个持久的气旋协作组，包括工作室、绑定现有 Agent 的工位和共享群聊。只搭建结构，不会自动启动成员执行。',
    },
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'members', 'room'],
      properties: {
        title: textSchema, chairAgentId: idSchema,
        members: {
          type: 'array', minItems: 1, maxItems: 12,
          items: {
            type: 'object', additionalProperties: false, required: ['agentId', 'title'],
            properties: {
              agentId: idSchema, title: textSchema, rolePrompt: textSchema,
              duty: textSchema, overrideAgentRole: { type: 'boolean' },
            },
          },
        },
        room: {
          type: 'object', additionalProperties: false, required: ['title', 'topic'],
          properties: {
            title: textSchema, topic: textSchema,
            mode: { type: 'string', enum: ['build', 'plan'] },
          },
        },
      },
    },
    output: { mode: 'inline', budget: { items: { default: 20, max: 40 } } },
  }, {
    id: 'readCollaborationGroup', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: {
      name: 'read_collaboration_group',
      description: '读取气旋协作组结构和跨房间最近公共发言。输出受中心预算限制。',
    },
    inputSchema: { type: 'object', additionalProperties: false, required: ['workshopId'],
      properties: { workshopId: idSchema } },
    output: { mode: 'inline', budget: {
      items: { default: 20, max: 50 }, textChars: { default: 8_000, max: 16_000 },
      textLines: { default: 160, max: 320 },
    } },
  }];
  if (includeRound) methods.push({
    id: 'startCollaborationRound', kind: 'command', permission: 'execute',
    audiences: ['agent', 'internal'],
    agentTool: {
      name: 'start_collaboration_round',
      description: '在已有气旋协作组房间中启动一轮公共协作，并返回可等待的运行句柄。',
    },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId', 'roomId', 'message'], properties: {
        workshopId: idSchema, roomId: idSchema,
        message: { type: 'string', minLength: 1, maxLength: 20_000 },
      } },
    output: { mode: 'operation' },
  });
  return methods;
}

export function cycloneCollaborationHandlers(
  collaborations: CycloneCollaborationService,
  rounds?: CycloneCollaborationRoundService,
): Record<string, ModuleMethodHandler> {
  return {
    createCollaborationGroup: {
      parse: parseGroup,
      invoke: async (_context, input) => collaborations.create(input as CreateCollaborationGroupInput),
    },
    readCollaborationGroup: {
      parse: parseWorkshop,
      invoke: (context, input) => collaborations.read(
        (input as { workshopId: string }).workshopId, context.budget,
      ),
    },
    ...(rounds ? { startCollaborationRound: {
      parse: parseRound,
      invoke: (_context, input) => rounds.start(input as {
        workshopId: string; roomId: string; message: string;
      }),
    } } : {}),
  };
}

function parseRound(value: unknown): { workshopId: string; roomId: string; message: string } {
  const record = exactRecord(value, ['workshopId', 'roomId', 'message']);
  const message = text(record.message, 20_000);
  return { workshopId: id(record.workshopId), roomId: id(record.roomId), message };
}

function parseWorkshop(value: unknown): { workshopId: string } {
  const record = exactRecord(value, ['workshopId']);
  return { workshopId: id(record.workshopId) };
}

function parseGroup(value: unknown): CreateCollaborationGroupInput {
  const record = exactRecord(value, ['title', 'chairAgentId', 'members', 'room']);
  if (!Array.isArray(record.members) || record.members.length < 1 || record.members.length > 12) {
    throw invalidInput();
  }
  const room = exactRecord(record.room, ['title', 'topic', 'mode']);
  return {
    title: text(record.title),
    ...(record.chairAgentId === undefined ? {} : { chairAgentId: id(record.chairAgentId) }),
    members: record.members.map(member),
    room: {
      title: text(room.title), topic: text(room.topic),
      ...(room.mode === undefined ? {} : { mode: mode(room.mode) }),
    },
  };
}

function member(value: unknown): CollaborationGroupMember {
  const record = exactRecord(value, [
    'agentId', 'title', 'rolePrompt', 'duty', 'overrideAgentRole',
  ]);
  return {
    agentId: id(record.agentId), title: text(record.title),
    ...optionalText(record, 'rolePrompt'), ...optionalText(record, 'duty'),
    ...(record.overrideAgentRole === undefined ? {} : {
      overrideAgentRole: bool(record.overrideAgentRole),
    }),
  };
}

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw invalidInput();
  return record;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidInput();
  }
  return value;
}

function text(value: unknown, maxLength = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw invalidInput();
  return value.trim();
}

function optionalText(record: Record<string, unknown>, key: string): Record<string, string> {
  return record[key] === undefined ? {} : { [key]: text(record[key]) };
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidInput();
  return value;
}

function mode(value: unknown): 'build' | 'plan' {
  if (value !== 'build' && value !== 'plan') throw invalidInput();
  return value;
}

function invalidInput(): never {
  throw frameworkError({
    code: 'CYCLONE_GROUP_INPUT_INVALID', kind: 'validation', message: '气旋协作组参数无效',
    source: 'cyclone.collaborations', retryable: false,
  });
}
