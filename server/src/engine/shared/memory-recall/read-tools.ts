import type { ToolDef } from '../tool-defs-loader.js';
import { recallObject } from './storage.js';
import { searchRecall, type RecallSearch } from './retrieval.js';
import type { RecallSources } from './contracts.js';
import { MEMORY_REFERENCE_NOTE } from '../memory-guidance.js';

export const RECALL_TOOL_NAMES = ['recall_search', 'recall_read'] as const;
export function recallToolDefs(): ToolDef[] {
  return [
    { name: 'recall_search', description: '统一搜索自己的精选记忆与压缩工作记录；不填query按更新时间分页浏览，主动查询默认包含归档。用kind、category、status筛选，读取后可用memory_manage整理精选记忆。返回有出处的短索引；按日期、当日压缩序号或会话缩小范围，再用 recall_read 核对正文。',
      parameters: { type: 'object', properties: {
        query: { type: 'string', description: '需要找回的内容；省略或空字符串则浏览索引' },
        status: { type: 'string', enum: ['all', 'active', 'archived'] },
        category: { type: 'string', enum: ['feedback', 'fact', 'pitfall', 'reference'] },
        offset: { type: 'integer', description: '结果偏移，默认0' },
        kind: { type: 'string', enum: ['memory', 'work'] }, date: { type: 'string', description: 'YYYY-MM-DD' },
        sequence: { type: 'integer', description: '该日期内的压缩序号' }, sessionId: { type: 'string' },
        limit: { type: 'integer', description: '最多20条' },
      } } },
    { name: 'recall_read', description: '按 recall_search 的 id 分段读取记忆或压缩工作记录。view=source可追溯工作记录覆盖的原会话；精选记忆的source.updated是维护操作所需expectedUpdated；工作记录只读，历史计划与实际结果分别判断。',
      parameters: { type: 'object', properties: {
        id: { type: 'string' }, offset: { type: 'integer', description: '正文字符偏移，默认0' },
        limit: { type: 'integer', description: '默认2000字符；工作记录最多4000，精选记忆显式读取最多100000，其余用offset续读' },
        view: { type: 'string', enum: ['record', 'source'], description: 'record=记忆/交接正文，source=原会话' },
      }, required: ['id'] } },
  ];
}
export async function executeRecallTool(dataDir: string, agentId: string, sources: RecallSources,
  tool: string, input: unknown, options: { embeddingModel?: string | null; signal?: AbortSignal; level?: 'L2' | 'L3' } = {}): Promise<string> {
  if (!recallObject(input)) throw new Error('RECALL_ARGUMENTS_INVALID');
  const keys = tool === 'recall_search' ? ['query', 'kind', 'date', 'sequence', 'sessionId', 'limit', 'offset', 'status', 'category'] : ['id', 'offset', 'limit', 'view'];
  if (!RECALL_TOOL_NAMES.includes(tool as typeof RECALL_TOOL_NAMES[number])
    || Object.keys(input).some(key => !keys.includes(key))) throw new Error('RECALL_ARGUMENTS_INVALID');
  options.signal?.throwIfAborted();
  if (tool === 'recall_search') {
    if ((input.query !== undefined && typeof input.query !== 'string')
      || (input.status !== undefined && !['all', 'active', 'archived'].includes(String(input.status)))
      || (input.category !== undefined && !['feedback', 'fact', 'pitfall', 'reference'].includes(String(input.category))) || (input.kind !== undefined && !['memory', 'work'].includes(String(input.kind)))
      || (input.date !== undefined && (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)))
      || (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || input.sessionId.length > 180))) throw new Error('RECALL_ARGUMENTS_INVALID');
    const request: RecallSearch = { query: (input.query as string | undefined) ?? '', status: input.status as RecallSearch['status'],
      category: input.category as string | undefined, offset: integer(input.offset, 0, 0, 10000000), kind: input.kind as RecallSearch['kind'],
      date: input.date as string | undefined, sessionId: input.sessionId as string | undefined,
      limit: integer(input.limit, 12, 1, 20),
      ...(input.sequence !== undefined ? { sequence: integer(input.sequence, 1, 1, 1000000) } : {}) };
    const { queryVector: _vector, ...result } = await searchRecall(dataDir, agentId, sources, request,
      { ...options, candidates: options.level === 'L2', includeArchived: options.level !== 'L2' });
    return JSON.stringify({ level: options.level ?? 'L3', note: MEMORY_REFERENCE_NOTE, ...result });
  }
  if (typeof input.id !== 'string' || input.id.length > 180) throw new Error('RECALL_ARGUMENTS_INVALID');
  const document = await sources.read(agentId, input.id);
  if (!document) throw new Error('RECALL_SOURCE_UNAVAILABLE');
  const offset = integer(input.offset, 0, 0, 10000000), limit = integer(input.limit, 2000, 1, document.kind === 'memory' ? 100000 : 4000);
  const { content, ...source } = document;
  if (input.view !== undefined && input.view !== 'record' && input.view !== 'source') throw new Error('RECALL_ARGUMENTS_INVALID');
  if (input.view === 'source' && document.kind === 'work') {
    const original = await sources.readOriginal?.(agentId, input.id, offset, limit);
    if (!original) throw new Error('RECALL_SOURCE_UNAVAILABLE');
    return JSON.stringify({ level: options.level ?? 'L3', note: MEMORY_REFERENCE_NOTE, source, view: 'source', offset, ...original,
      hasMore: offset + original.content.length < original.total });
  }
  return JSON.stringify({ level: options.level ?? 'L3', note: MEMORY_REFERENCE_NOTE, source, offset, total: content.length,
    content: content.slice(offset, offset + limit), hasMore: offset + limit < content.length });
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < min || number > max) throw new Error('RECALL_ARGUMENTS_INVALID');
  return number;
}
