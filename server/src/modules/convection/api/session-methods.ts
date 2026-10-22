import type {
  ModuleMethodHandler,
  ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  ConvectionSessionService,
  CreateConvectionSessionInput,
} from '../application/session-service.js';

const writeAudience: ModuleMethodManifest['audiences'] = ['human', 'internal'];
const idSchema = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
const participantSchema = { type: 'array', minItems: 1, maxItems: 12,
  uniqueItems: true, items: idSchema };
const agentActions: Record<string, { name: string; description: string;
  properties: Record<string, unknown> }> = {
  joinSession: { name: 'join_discussion', description: '让一个已有 Agent 加入下一轮会议回复，默认排在发言顺序末尾；需要指定顺序时再调用 reorder_discussion。',
    properties: { sessionId: idSchema, agentId: idSchema } },
  leaveSession: { name: 'leave_discussion', description: '让一个与会 Agent 退出下一轮会议回复；会议至少保留一名与会者。',
    properties: { sessionId: idSchema, agentId: idSchema } },
  reorderSession: { name: 'reorder_discussion', description: '设置下一轮与会 Agent 的完整回复顺序。',
    properties: { sessionId: idSchema, participantAgentIds: participantSchema } },
  deleteSession: { name: 'delete_discussion', description: '删除指定对流会议室及其会话内容。',
    properties: { sessionId: idSchema } },
};

export function convectionSessionManifests(): ModuleMethodManifest[] {
  return [
    method('createSession', 'design', ['chairAgentId', 'participantAgentIds']),
    method('renameSession', 'design', ['sessionId', 'title']),
    method('joinSession', 'design', ['sessionId', 'agentId']),
    method('leaveSession', 'design', ['sessionId', 'agentId']),
    method('reorderSession', 'design', ['sessionId', 'participantAgentIds']),
    method('setChair', 'design', ['sessionId', 'agentId']),
    method('deleteSession', 'administer', ['sessionId']),
    method('editMessage', 'design', ['sessionId', 'index', 'content']),
    method('deleteMessage', 'administer', ['sessionId', 'index']),
    method('resetContext', 'administer', ['sessionId', 'mode']),
    method('compactContext', 'administer', ['sessionId']),
    method('compactChairContext', 'administer', ['sessionId']),
    method('resetChairContext', 'administer', ['sessionId']),
  ];
}

export function convectionSessionHandlers(
  sessions: ConvectionSessionService,
): Record<string, ModuleMethodHandler> {
  return {
    createSession: {
      parse: parseCreate,
      invoke: async (_context, input) => sessions.create(input as CreateConvectionSessionInput),
    },
    renameSession: action(parseTextAction, async input => {
      await sessions.rename(input.sessionId, input.value);
      return { ok: true };
    }),
    joinSession: action(parseAgentAction, async input => ({
      participantAgentIds: await sessions.join(input.sessionId, input.value),
    })),
    leaveSession: action(parseAgentAction, async input => ({
      participantAgentIds: await sessions.leave(input.sessionId, input.value),
    })),
    reorderSession: {
      parse: parseReorder,
      invoke: async (_context, input) => {
        const value = input as { sessionId: string; participantAgentIds: string[] };
        return { participantAgentIds: await sessions.reorder(
          value.sessionId, value.participantAgentIds,
        ) };
      },
    },
    setChair: action(parseAgentAction, async input => ({
      chairAgentId: await sessions.setChair(input.sessionId, input.value),
    })),
    deleteSession: action(parseSession, async input => {
      await sessions.remove(input.sessionId);
      return { ok: true };
    }),
    editMessage: {
      parse: parseEdit,
      invoke: async (_context, input) => {
        const value = input as { sessionId: string; index: number; content: string };
        await sessions.editMessage(value.sessionId, value.index, value.content);
        return { ok: true };
      },
    },
    deleteMessage: {
      parse: parseMessageIndex,
      invoke: async (_context, input) => {
        const value = input as { sessionId: string; index: number };
        await sessions.deleteMessage(value.sessionId, value.index);
        return { ok: true };
      },
    },
    resetContext: {
      parse: parseReset,
      invoke: async (context, input) => {
        const value = input as { sessionId: string; mode: 'clean' | 'summary' };
        return sessions.resetContext(value.sessionId, value.mode, context.signal);
      },
    },
    compactContext: {
      parse: parseSession,
      invoke: async (context, input) => sessions.resetContext((input as { sessionId: string }).sessionId, 'summary', context.signal),
    },
    compactChairContext: { parse: parseSession, invoke: (context, input) =>
      sessions.changeChairContext((input as { sessionId: string }).sessionId, 'summary', context.signal) },
    resetChairContext: { parse: parseSession, invoke: (context, input) =>
      sessions.changeChairContext((input as { sessionId: string }).sessionId, 'clean', context.signal) },
  };
}

interface ValueAction { sessionId: string; value: string }

function action<T>(
  parse: (value: unknown) => T,
  invoke: (input: T) => Promise<unknown>,
): ModuleMethodHandler {
  return { parse, invoke: async (_context, input) => invoke(input as T) };
}

function method(
  id: string,
  permission: ModuleMethodManifest['permission'],
  required: string[],
): ModuleMethodManifest {
  const agent = agentActions[id];
  return {
    id, kind: 'command', permission,
    audiences: agent ? ['human', 'agent', 'internal'] : writeAudience,
    ...(agent ? { agentTool: { name: agent.name, description: agent.description } } : {}),
    inputSchema: { type: 'object', additionalProperties: false, required,
      ...(agent ? { properties: agent.properties } : {}) },
    output: { mode: 'inline' },
  };
}

function parseCreate(value: unknown): CreateConvectionSessionInput {
  const record = recordWith(value, ['chairAgentId', 'participantAgentIds', 'topic', 'title']);
  if (!Array.isArray(record.participantAgentIds)) throw invalidInput();
  return {
    chairAgentId: text(record.chairAgentId),
    participantAgentIds: record.participantAgentIds.map(text),
    ...(record.topic === undefined ? {} : { topic: text(record.topic) }),
    ...(record.title === undefined ? {} : { title: text(record.title) }),
  };
}

function parseTextAction(value: unknown): ValueAction {
  const record = recordWith(value, ['sessionId', 'title']);
  return { sessionId: text(record.sessionId), value: text(record.title) };
}

function parseAgentAction(value: unknown): ValueAction {
  const record = recordWith(value, ['sessionId', 'agentId']);
  return { sessionId: text(record.sessionId), value: text(record.agentId) };
}

function parseSession(value: unknown): { sessionId: string } {
  const record = recordWith(value, ['sessionId']);
  return { sessionId: text(record.sessionId) };
}

function parseReorder(value: unknown): { sessionId: string; participantAgentIds: string[] } {
  const record = recordWith(value, ['sessionId', 'participantAgentIds']);
  if (!Array.isArray(record.participantAgentIds)) throw invalidInput();
  return { sessionId: text(record.sessionId), participantAgentIds: record.participantAgentIds.map(text) };
}

function parseEdit(value: unknown): { sessionId: string; index: number; content: string } {
  const record = recordWith(value, ['sessionId', 'index', 'content']);
  return { sessionId: text(record.sessionId), index: index(record.index),
    content: typeof record.content === 'string' ? record.content : invalidInput() };
}

function parseMessageIndex(value: unknown): { sessionId: string; index: number } {
  const record = recordWith(value, ['sessionId', 'index']);
  return { sessionId: text(record.sessionId), index: index(record.index) };
}

function parseReset(value: unknown): { sessionId: string; mode: 'clean' | 'summary' } {
  const record = recordWith(value, ['sessionId', 'mode']);
  if (record.mode !== 'clean' && record.mode !== 'summary') throw invalidInput();
  return { sessionId: text(record.sessionId), mode: record.mode };
}

function recordWith(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw invalidInput();
  return record;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidInput();
  return value;
}

function index(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw invalidInput();
  return value as number;
}

function invalidInput(): never {
  throw frameworkError({ code: 'CONVECTION_SESSION_INPUT_INVALID', kind: 'validation',
    message: '对流会话参数无效', source: 'convection.module', retryable: false });
}
