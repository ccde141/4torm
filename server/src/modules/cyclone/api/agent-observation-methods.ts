import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneAgentObservationService } from '../application/agent-observation-service.js';

const identifier = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
const cursor = { type: 'string', maxLength: 96 };
const revision = { type: 'integer', minimum: 0 };

export function cycloneAgentObservationManifests(): ModuleMethodManifest[] {
  return [
    method('readCollaborationConsole', 'read_collaboration_console',
      '读取工作室项目统计、最近 6 项事件与分页工位摘要；指定 seatId 读取工位职责、局部协作开关与分页继承能力。limit 默认 8、最多 12，字段有界、总响应最多 24000 字符；游标变化冲突时重新读取。',
      ['workshopId'], { workshopId: identifier, seatId: identifier, cursor,
        limit: { type: 'integer', minimum: 1, maximum: 12 } }),
    method('readCollaborationSeatMemory', 'read_collaboration_seat_memory',
      '读取工位独立记忆的分页索引（默认 12、最多 24）；指定 entryId 和当前 revision，按 offset 读取最多 6000 字符正文。仅含本工位记忆，不含绑定 Agent 的记忆；版本变化须重新定位。总响应最多 24000 字符，不提供修改权限。',
      ['workshopId', 'seatId'], { workshopId: identifier, seatId: identifier,
        entryId: { type: 'string', minLength: 1, maxLength: 160 }, revision, cursor,
        limit: { type: 'integer', minimum: 1, maximum: 24 },
        offset: { type: 'integer', minimum: 0 } }),
    method('readCollaborationSeatHistory', 'read_collaboration_seat_history',
      '分页读取工位执行、协作与岗位配置、绑定和记忆变更履历；filter为all/work/changes，默认8、最多12，按nextCursor续读。履历不是当前执行完成凭证。',
      ['workshopId', 'seatId'], { workshopId: identifier, seatId: identifier, cursor,
        filter: { type: 'string', enum: ['all', 'work', 'changes'] },
        limit: { type: 'integer', minimum: 1, maximum: 12 } }),
  ];
}

export function cycloneAgentObservationHandlers(service: CycloneAgentObservationService): Record<string, ModuleMethodHandler> {
  return {
    readCollaborationConsole: { parse: parseConsole,
      invoke: (_context, input) => service.readConsole(input as ReturnType<typeof parseConsole>) },
    readCollaborationSeatMemory: { parse: parseMemory,
      invoke: (_context, input) => service.readMemory(input as ReturnType<typeof parseMemory>) },
    readCollaborationSeatHistory: { parse: parseHistory,
      invoke: (_context, input) => service.readHistory(input as ReturnType<typeof parseHistory>) },
  };
}

function parseHistory(value: unknown) {
  const item = exact(value, ['workshopId', 'seatId', 'filter', 'limit', 'cursor']);
  if (item.filter !== undefined && !['all', 'work', 'changes'].includes(String(item.filter))) throw invalid('履历筛选无效');
  return { workshopId: id(item.workshopId, 'workshopId'), seatId: id(item.seatId, 'seatId'),
    ...(item.filter === undefined ? {} : { filter: item.filter as 'all' | 'work' | 'changes' }),
    ...pagination(item, 12) };
}

function parseConsole(value: unknown) {
  const item = exact(value, ['workshopId', 'seatId', 'cursor', 'limit']);
  return { workshopId: id(item.workshopId, 'workshopId'),
    ...(item.seatId === undefined ? {} : { seatId: id(item.seatId, 'seatId') }),
    ...pagination(item, 12) };
}

function parseMemory(value: unknown) {
  const item = exact(value, ['workshopId', 'seatId', 'entryId', 'revision', 'cursor', 'limit', 'offset']);
  const identity = { workshopId: id(item.workshopId, 'workshopId'), seatId: id(item.seatId, 'seatId') };
  const version = item.revision === undefined ? {} : { revision: integer(item.revision, 'revision') };
  if (item.entryId !== undefined) {
    if (item.revision === undefined) throw invalid('读取 entryId 正文必须填写 revision，请先读取记忆索引取得版本');
    if (item.cursor !== undefined || item.limit !== undefined) {
      throw invalid('读取 entryId 正文使用 offset 续读，不能同时填写 cursor 或 limit');
    }
    return { ...identity, entryId: text(item.entryId, 160, 'entryId'), ...version,
      ...(item.offset === undefined ? {} : { offset: integer(item.offset, 'offset') }) };
  }
  if (item.offset !== undefined) throw invalid('offset 仅用于读取记忆正文，请同时填写 entryId 和 revision');
  return { ...identity, ...version, ...pagination(item, 24) };
}

function pagination(item: Record<string, unknown>, max: number) {
  const limit = item.limit === undefined ? undefined : integer(item.limit, 'limit', max, 1);
  return { ...(limit === undefined ? {} : { limit }),
    ...(item.cursor === undefined ? {} : { cursor: text(item.cursor, 96, 'cursor') }) };
}

function method(id: string, name: string, description: string, required: string[],
  properties: Record<string, unknown>): ModuleMethodManifest {
  return { id, kind: 'query', permission: 'observe', audiences: ['agent', 'internal'],
    agentTool: { name, description }, inputSchema: { type: 'object', additionalProperties: false,
      required, properties }, output: { mode: 'inline' } };
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('参数必须为包含 workshopId 的对象；读取工位记忆还需 seatId');
  }
  const extra = Object.keys(value).find(key => !keys.includes(key));
  if (extra !== undefined) throw invalid(`不支持参数 ${extra.slice(0, 80)}，请按当前工具字段重新填写`);
  return value as Record<string, unknown>;
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalid(`${field} 缺失或无效，请填写所属${field === 'workshopId' ? '工作室' : '工位'}的完整 ID`);
  }
  return value;
}

function text(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw invalid(`${field} 必须为 1 至 ${max} 字符的字符串`);
  }
  return value;
}

function integer(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw invalid(`${field} 必须为 ${min} 至 ${max} 的整数`);
  }
  return value as number;
}

function invalid(message: string) {
  return frameworkError({ code: 'CYCLONE_AGENT_OBSERVATION_INPUT_INVALID', kind: 'validation',
    message, source: 'cyclone.agent-observation', retryable: false });
}
