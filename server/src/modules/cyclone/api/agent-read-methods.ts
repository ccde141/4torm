import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneAgentReadService, CycloneThreadTarget } from '../application/agent-read-service.js';

const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
const cursor = { type: 'string', maxLength: 160 };
const limit = { type: 'integer', minimum: 1, maximum: 50 };
const threadKeys = { workshopId: id, target: { type: 'string', enum: ['seat', 'room', 'chair', 'supervisor'] },
  targetId: id };

export function cycloneAgentReadManifests(): ModuleMethodManifest[] {
  return [
    method('listCollaborationAgents', 'list_collaboration_agents',
      '列出可绑定到气旋工位的全局 Agent ID 和名称，分页返回。', [], { limit, cursor }),
    method('listCollaborationWorkshops', 'list_collaboration_workshops',
      '列出已有气旋工作室、工位数和房间数，分页返回。', [], { limit, cursor }),
    method('readCollaborationThread', 'read_collaboration_thread',
      '按工作室和目标读取群聊、工位、会长或主管的最近 24 条普通对话；主管用 target=supervisor、targetId=supervisor。长正文只给预览，使用游标续读。',
      ['workshopId', 'target', 'targetId'], { ...threadKeys,
        limit: { ...limit, maximum: 24 }, cursor }),
    method('readCollaborationMessage', 'read_collaboration_message',
      '按会话 revision 与消息索引分段读取正文或工具记录；会话变化时要求重新定位。',
      ['workshopId', 'target', 'targetId', 'revision', 'index'], { ...threadKeys,
        revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        index: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0 },
        part: { type: 'string', enum: ['content', 'tools'] },
      }),
  ];
}

export function cycloneAgentReadHandlers(service: CycloneAgentReadService): Record<string, ModuleMethodHandler> {
  return {
    listCollaborationAgents: { parse: parseList, invoke: (_context, input) => {
      const { limit, cursor } = input as ListInput;
      return service.agents(limit, cursor);
    } },
    listCollaborationWorkshops: { parse: parseList, invoke: (_context, input) => {
      const { limit, cursor } = input as ListInput;
      return service.workshops(limit, cursor);
    } },
    readCollaborationThread: { parse: parseThread, invoke: (_context, input) => (
      service.thread(input as ReturnType<typeof parseThread>)
    ) },
    readCollaborationMessage: { parse: parseMessage, invoke: (_context, input) => (
      service.message(input as ReturnType<typeof parseMessage>)
    ) },
  };
}

function method(id: string, name: string, description: string, required: string[],
  properties: Record<string, unknown>): ModuleMethodManifest {
  return { id, kind: 'query', permission: 'observe', audiences: ['agent', 'internal'],
    agentTool: { name, description },
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    output: { mode: 'inline' } };
}

interface ListInput { limit?: number; cursor?: string }

function parseList(value: unknown): ListInput {
  const item = exact(value, ['limit', 'cursor']);
  return { ...(item.limit === undefined ? {} : { limit: integer(item.limit, 50) }),
    ...(item.cursor === undefined ? {} : { cursor: shortText(item.cursor, 160) }) };
}

function parseThread(value: unknown) {
  const item = exact(value, ['workshopId', 'target', 'targetId', 'limit', 'cursor']);
  return { workshopId: identifier(item.workshopId), target: target(item.target),
    targetId: identifier(item.targetId),
    ...(item.limit === undefined ? {} : { limit: integer(item.limit, 24) }),
    ...(item.cursor === undefined ? {} : { cursor: shortText(item.cursor, 160) }) };
}

function parseMessage(value: unknown) {
  const item = exact(value, [
    'workshopId', 'target', 'targetId', 'revision', 'index', 'offset', 'part',
  ]);
  const revision = shortText(item.revision, 64);
  if (!/^[a-f0-9]{64}$/.test(revision)) throw invalid();
  return { workshopId: identifier(item.workshopId), target: target(item.target),
    targetId: identifier(item.targetId), revision, index: nonnegative(item.index),
    ...(item.offset === undefined ? {} : { offset: nonnegative(item.offset) }),
    ...(item.part === undefined ? {} : { part: part(item.part) }) };
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}

function shortText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value;
}

function integer(value: unknown, max: number): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) throw invalid();
  return value as number;
}

function nonnegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
}

function target(value: unknown): CycloneThreadTarget {
  if (value !== 'seat' && value !== 'room' && value !== 'chair' && value !== 'supervisor') throw invalid();
  return value;
}

function part(value: unknown): 'content' | 'tools' {
  if (value !== 'content' && value !== 'tools') throw invalid();
  return value;
}

function invalid() {
  return frameworkError({ code: 'CYCLONE_AGENT_READ_INPUT_INVALID', kind: 'validation',
    message: '气旋读取参数无效', source: 'cyclone.agent-read', retryable: false });
}
