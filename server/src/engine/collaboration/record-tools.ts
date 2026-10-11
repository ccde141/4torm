import { frameworkError } from '../shared/framework-error.js';
import {
  COLLABORATION_FEATURES,
  type AgentToolDefinition, type CollaborationContext, type CollaborationFeature,
} from './contracts.js';
import type { CollaborationRouter } from './router.js';

const feature = { type: 'string', enum: [...COLLABORATION_FEATURES] };
const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };

const definitions: AgentToolDefinition[] = [{
  name: 'find_operation_records',
  description: '按功能区、事项和时间查找已保存的执行记录 ID；只返回有界索引，再按需读取正文。',
  parameters: { type: 'object', additionalProperties: false, required: ['feature'],
    properties: {
      feature, operationId: id, agentId: id, since: { type: 'string' }, until: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: { type: 'string' },
    } },
}, {
  name: 'read_operation_record',
  description: '按功能区、事项 ID 和运行 ID 分页读取已保存的执行记录；续读时传回 nextCursor。',
  parameters: { type: 'object', additionalProperties: false,
    required: ['feature', 'operationId', 'runId'],
    properties: { feature, operationId: id, runId: id,
      maxTextChars: { type: 'integer', minimum: 1, maximum: 12_000 },
      maxTextLines: { type: 'integer', minimum: 1, maximum: 200 },
      cursor: { type: 'string' },
    } },
}];

export function recordToolDefinitions(): AgentToolDefinition[] {
  return structuredClone(definitions);
}

export function isRecordTool(name: string): boolean {
  return definitions.some(definition => definition.name === name);
}

export async function invokeRecordTool(
  router: CollaborationRouter, name: string, input: unknown, context: CollaborationContext,
): Promise<unknown> {
  const value = object(input);
  const target = parseFeature(value.feature);
  const scoped = { ...context, enabledFeatures: new Set([target]) };
  if (name === 'find_operation_records') {
    exactKeys(value, ['feature', 'operationId', 'agentId', 'since', 'until', 'limit', 'cursor']);
    return router.listOperationRecords(target, {
      ...(value.operationId === undefined ? {} : { operationId: identifier(value.operationId) }),
      ...(value.agentId === undefined ? {} : { agentId: identifier(value.agentId) }),
      ...(value.since === undefined ? {} : { since: string(value.since) }),
      ...(value.until === undefined ? {} : { until: string(value.until) }),
      ...(value.limit === undefined ? {} : { limit: integer(value.limit, 50) }),
      ...(value.cursor === undefined ? {} : { cursor: string(value.cursor) }),
    }, scoped);
  }
  if (name !== 'read_operation_record') throw invalid();
  exactKeys(value, ['feature', 'operationId', 'runId', 'maxTextChars', 'maxTextLines', 'cursor']);
  return router.readOperationRecord(target, {
    operationId: identifier(value.operationId), runId: identifier(value.runId),
  }, {
    ...(value.maxTextChars === undefined ? {} : {
      maxTextChars: integer(value.maxTextChars, 12_000),
    }),
    ...(value.maxTextLines === undefined ? {} : {
      maxTextLines: integer(value.maxTextLines, 200),
    }),
    ...(value.cursor === undefined ? {} : { cursor: string(value.cursor) }),
  }, scoped);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw invalid();
}

function parseFeature(value: unknown): CollaborationFeature {
  if (typeof value !== 'string'
    || !(COLLABORATION_FEATURES as readonly string[]).includes(value)) throw invalid();
  return value as CollaborationFeature;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalid();
  }
  return value;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) throw invalid();
  return value;
}

function integer(value: unknown, max: number): number {
  const parsed = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || (parsed as number) < 1 || (parsed as number) > max) {
    throw invalid();
  }
  return parsed as number;
}

function invalid() {
  return frameworkError({ code: 'RECORD_TOOL_INPUT_INVALID', kind: 'validation',
    message: '运行记录工具参数无效', source: 'collaboration.records', retryable: false });
}
