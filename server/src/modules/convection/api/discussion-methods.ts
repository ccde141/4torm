import type {
  ModuleMethodHandler, ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  ConvectionDiscussionService,
  CreateDiscussionInput,
} from '../application/discussion-service.js';

const idSchema = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
const textSchema = { type: 'string', minLength: 1, maxLength: 2_000 };

export function convectionDiscussionManifests(): ModuleMethodManifest[] {
  return [{
    id: 'listDiscussions', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'list_discussions',
      description: '分页列出对流会议室 ID、议题、主席及下一轮与会 Agent 顺序。' },
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { cursor: { type: 'string' } } },
    output: { mode: 'inline', budget: { items: { default: 20, max: 50 } } },
  }, {
    id: 'createDiscussion', kind: 'command', permission: 'design',
    audiences: ['human', 'agent', 'internal'],
    agentTool: {
      name: 'create_discussion',
      description: '创建一个持久的对流多 Agent 会议，设置主席、参与者和议题。只创建会议，不会自动开始发言轮次。',
    },
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'topic', 'chairAgentId', 'participantAgentIds'],
      properties: {
        title: textSchema, topic: textSchema, chairAgentId: idSchema,
        participantAgentIds: {
          type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: idSchema,
        },
      },
    },
    output: { mode: 'inline', budget: { items: { default: 20, max: 40 } } },
  }, {
    id: 'readDiscussion', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: {
      name: 'read_discussion',
      description: '读取会议公共发言或会议助理私聊的最新快照；运行中包含已生成的部分文字与未完成提示。',
    },
    inputSchema: { type: 'object', additionalProperties: false, required: ['sessionId'],
      properties: { sessionId: idSchema, scope: { enum: ['public', 'chair'] } } },
    output: { mode: 'inline', budget: {
      items: { default: 20, max: 50 }, textChars: { default: 8_000, max: 16_000 },
      textLines: { default: 160, max: 320 },
    } },
  }, {
    id: 'listDiscussionRounds', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'list_discussion_rounds',
      description: '按时间倒序列出会议的公开轮次或会议助理私聊轮次，返回状态和轮次 ID。' },
    inputSchema: { type: 'object', additionalProperties: false, required: ['sessionId'],
      properties: { sessionId: idSchema, scope: { enum: ['public', 'chair'] },
        cursor: { type: 'string' } } },
    output: { mode: 'inline', budget: { items: { default: 20, max: 50 } } },
  }, {
    id: 'readDiscussionRound', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'read_discussion_round',
      description: '按轮次 ID 读取一次发话及串行回复；运行中包含最新草稿，旧归档按原文读取。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['sessionId', 'roundId'], properties: {
        sessionId: idSchema, roundId: { type: 'string', minLength: 1 },
        scope: { enum: ['public', 'chair'] },
      } },
    output: { mode: 'inline', budget: { items: { default: 20, max: 50 },
      textChars: { default: 8_000, max: 16_000 },
      textLines: { default: 160, max: 320 } } },
  }];
}

export function convectionDiscussionHandlers(
  discussions: ConvectionDiscussionService,
): Record<string, ModuleMethodHandler> {
  return {
    listDiscussions: { parse: parseList,
      invoke: (context, input) => discussions.list(context.budget,
        (input as { cursor?: string }).cursor) },
    createDiscussion: {
      parse: parseDiscussion,
      invoke: (_context, input) => discussions.create(input as CreateDiscussionInput),
    },
    readDiscussion: {
      parse: parseSession,
      invoke: (context, input) => discussions.read(
        (input as { sessionId: string }).sessionId, context.budget,
        (input as { scope: 'public' | 'chair' }).scope,
      ),
    },
    listDiscussionRounds: { parse: parseRoundList,
      invoke: (context, input) => {
        const value = input as { sessionId: string; scope: 'public' | 'chair'; cursor?: string };
        return discussions.listRounds(value.sessionId, value.scope, context.budget, value.cursor);
      } },
    readDiscussionRound: { parse: parseRoundRead,
      invoke: (context, input) => {
        const value = input as { sessionId: string; roundId: string; scope: 'public' | 'chair' };
        return discussions.readRound(value.sessionId, value.roundId, value.scope, context.budget);
      } },
  };
}

function parseRoundList(value: unknown): { sessionId: string; scope: 'public' | 'chair'; cursor?: string } {
  const record = exactRecord(value, ['sessionId', 'scope', 'cursor']);
  const scope = parseScope(record.scope);
  if (record.cursor !== undefined && (typeof record.cursor !== 'string'
    || record.cursor.length > 200)) throw invalidInput();
  return { sessionId: id(record.sessionId), scope,
    ...(record.cursor === undefined ? {} : { cursor: record.cursor }) };
}

function parseRoundRead(value: unknown): { sessionId: string; roundId: string; scope: 'public' | 'chair' } {
  const record = exactRecord(value, ['sessionId', 'roundId', 'scope']);
  return { sessionId: id(record.sessionId), roundId: id(record.roundId),
    scope: parseScope(record.scope) };
}

function parseScope(value: unknown): 'public' | 'chair' {
  if (value !== undefined && value !== 'public' && value !== 'chair') throw invalidInput();
  return value ?? 'public';
}

function parseList(value: unknown): { cursor?: string } {
  const record = exactRecord(value, ['cursor']);
  if (record.cursor !== undefined && (typeof record.cursor !== 'string'
    || record.cursor.length > 512)) throw invalidInput();
  return record.cursor === undefined ? {} : { cursor: record.cursor };
}

function parseSession(value: unknown): { sessionId: string; scope: 'public' | 'chair' } {
  const record = exactRecord(value, ['sessionId', 'scope']);
  if (record.scope !== undefined && record.scope !== 'public' && record.scope !== 'chair') {
    throw invalidInput();
  }
  return { sessionId: id(record.sessionId), scope: record.scope ?? 'public' };
}

function parseDiscussion(value: unknown): CreateDiscussionInput {
  const record = exactRecord(value, ['title', 'topic', 'chairAgentId', 'participantAgentIds']);
  if (!Array.isArray(record.participantAgentIds)
    || record.participantAgentIds.length < 1 || record.participantAgentIds.length > 12) {
    throw invalidInput();
  }
  return {
    title: text(record.title), topic: text(record.topic), chairAgentId: id(record.chairAgentId),
    participantAgentIds: record.participantAgentIds.map(id),
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

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) throw invalidInput();
  return value.trim();
}

function invalidInput(): never {
  throw frameworkError({ code: 'CONVECTION_DISCUSSION_INPUT_INVALID', kind: 'validation',
    message: '对流会议参数无效', source: 'convection.discussions', retryable: false });
}
