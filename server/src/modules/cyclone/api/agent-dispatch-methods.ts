import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  CycloneAgentDispatchService, DispatchTextPart,
} from '../application/agent-dispatch-service.js';

const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };

export function cycloneAgentDispatchManifests(): ModuleMethodManifest[] {
  return [{
    id: 'listCollaborationDispatches', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'list_collaboration_dispatches',
      description: '分页查看气旋工作室的异步工位派发与回报状态；长内容另按 ID 读取。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId'], properties: {
        workshopId: id, limit: { type: 'integer', minimum: 1, maximum: 50 },
        cursor: { type: 'string', maxLength: 80 },
      } },
    output: { mode: 'inline', budget: { items: { default: 20, max: 50 },
      textChars: { default: 20_000, max: 40_000 } } },
  }, {
    id: 'readCollaborationDispatch', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'read_collaboration_dispatch',
      description: '按派发 ID 分段读取任务、回复或错误正文。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId', 'dispatchId', 'part'], properties: {
        workshopId: id, dispatchId: id,
        part: { type: 'string', enum: ['task', 'response', 'error'] },
        offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      } },
    output: { mode: 'inline', budget: { textChars: { default: 7_000, max: 7_000 } } },
  }, {
    id: 'includeCollaborationDispatch', kind: 'command', permission: 'design',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'include_collaboration_dispatch',
      description: '将已完成的派发结果带入原群聊公共讨论；不会忽略或删除派发。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId', 'roomId', 'dispatchId'],
      properties: { workshopId: id, roomId: id, dispatchId: id } },
    output: { mode: 'inline', budget: { textChars: { default: 3_000, max: 5_000 } } },
  }];
}

export function cycloneAgentDispatchHandlers(
  service: CycloneAgentDispatchService,
): Record<string, ModuleMethodHandler> {
  return {
    listCollaborationDispatches: { parse: parseList, invoke: (_context, input) => {
      const { workshopId, limit, cursor } = input as ReturnType<typeof parseList>;
      return service.list(workshopId, limit, cursor);
    } },
    readCollaborationDispatch: { parse: parseRead, invoke: (_context, input) => {
      const { workshopId, dispatchId, part, offset } = input as ReturnType<typeof parseRead>;
      return service.read(workshopId, dispatchId, part, offset);
    } },
    includeCollaborationDispatch: { parse: parseInclude, invoke: (_context, input) => {
      const { workshopId, roomId, dispatchId } = input as ReturnType<typeof parseInclude>;
      return service.include(workshopId, roomId, dispatchId);
    } },
  };
}

function parseList(value: unknown) {
  const item = exact(value, ['workshopId', 'limit', 'cursor']);
  return { workshopId: identifier(item.workshopId),
    ...(item.limit === undefined ? {} : { limit: integer(item.limit, 1, 50) }),
    ...(item.cursor === undefined ? {} : { cursor: text(item.cursor, 80) }) };
}

function parseRead(value: unknown) {
  const item = exact(value, ['workshopId', 'dispatchId', 'part', 'offset']);
  const part = item.part;
  if (part !== 'task' && part !== 'response' && part !== 'error') throw invalid();
  return { workshopId: identifier(item.workshopId), dispatchId: identifier(item.dispatchId),
    part: part as DispatchTextPart,
    ...(item.offset === undefined ? {} : { offset: integer(item.offset, 0, Number.MAX_SAFE_INTEGER) }) };
}

function parseInclude(value: unknown) {
  const item = exact(value, ['workshopId', 'roomId', 'dispatchId']);
  return { workshopId: identifier(item.workshopId), roomId: identifier(item.roomId),
    dispatchId: identifier(item.dispatchId) };
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

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw invalid();
  return value as number;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value;
}

function invalid() {
  return frameworkError({ code: 'CYCLONE_AGENT_DISPATCH_INPUT_INVALID',
    kind: 'validation', message: '气旋派发参数无效',
    source: 'cyclone.agent-dispatch', retryable: false });
}
