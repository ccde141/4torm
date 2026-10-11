import { createHash } from 'node:crypto';
import { frameworkError } from '../shared/framework-error.js';
import type {
  CollaborationContext, CollaborationFeature, FeatureModule,
  OperationIdentity, OperationRecordSummary,
} from './contracts.js';
import { COLLABORATION_STATUSES } from './contracts.js';
import { assertEnabled, assertPermission } from './router-guards.js';
import { pageRecord } from './record-page.js';

export interface RecordListInput {
  operationId?: string;
  agentId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export interface RecordReadInput {
  maxTextChars?: number;
  maxTextLines?: number;
  cursor?: string;
}

type Modules = ReadonlyMap<CollaborationFeature, FeatureModule>;

export async function listOperationRecords(
  modules: Modules, feature: CollaborationFeature, input: RecordListInput,
  context: CollaborationContext,
) {
  const module = recordModule(modules, feature, context);
  validateListInput(input);
  const items = (await module.records!.list(context)).map(item => validateSummary(item));
  const filtered = items.filter(item =>
    (!input.operationId || item.operationId === input.operationId)
    && (!input.agentId || item.agentId === input.agentId
      || item.agentIds?.includes(input.agentId))
    && (!input.since || item.timestamp >= input.since)
    && (!input.until || item.timestamp <= input.until))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)
      || a.operationId.localeCompare(b.operationId) || a.runId.localeCompare(b.runId));
  const revision = hash(JSON.stringify({ feature, input: {
    operationId: input.operationId, agentId: input.agentId,
    since: input.since, until: input.until,
  }, filtered }));
  const offset = input.cursor ? parseCursor(input.cursor, revision) : 0;
  if (offset > filtered.length) throw recordError('RECORD_CURSOR_STALE', '记录游标已失效');
  const limit = input.limit ?? 20;
  const selected = filtered.slice(offset, offset + limit);
  const next = offset + selected.length;
  return { feature, items: selected, truncated: next < filtered.length,
    ...(next < filtered.length ? { nextCursor: encodeCursor(revision, next) } : {}) };
}

export async function readOperationRecord(
  modules: Modules, feature: CollaborationFeature, identity: OperationIdentity,
  input: RecordReadInput, context: CollaborationContext,
) {
  const module = recordModule(modules, feature, context);
  validateIdentity(identity);
  validateReadInput(input);
  const content = await module.records!.read(context, identity);
  if (content === null) throw recordError('RECORD_NOT_FOUND', '运行记录不存在');
  return { feature, ...identity, format: 'json-fragment' as const,
    ...pageRecord(`${feature}:${identity.operationId}:${identity.runId}`, content,
      input.cursor, {
        maxTextChars: input.maxTextChars ?? 4_000,
        maxTextLines: input.maxTextLines ?? 80,
      }) };
}

function recordModule(
  modules: Modules, feature: CollaborationFeature, context: CollaborationContext,
): FeatureModule {
  assertEnabled(feature, context);
  assertPermission('observe', context, feature);
  const module = modules.get(feature);
  if (!module?.records) throw recordError('FEATURE_RECORDS_UNAVAILABLE',
    '功能模组未提供运行记录口');
  return module;
}

export function validateSummary(value: OperationRecordSummary): OperationRecordSummary {
  validateIdentity(value);
  if (typeof value.title !== 'string' || !value.title
    || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))
    || !(COLLABORATION_STATUSES as readonly string[]).includes(value.status)) {
    throw recordError('RECORD_SUMMARY_INVALID', '运行记录索引无效');
  }
  for (const field of [value.agentId, value.sessionId, value.linkedSessionId]) {
    if (field !== undefined && !validId(field)) {
      throw recordError('RECORD_SUMMARY_INVALID', '运行记录归属无效');
    }
  }
  if (value.agentIds !== undefined
    && (!Array.isArray(value.agentIds) || value.agentIds.some(id => !validId(id)))) {
    throw recordError('RECORD_SUMMARY_INVALID', '运行记录归属无效');
  }
  return value;
}

function validateIdentity(value: OperationIdentity): void {
  if (!value || ![value.operationId, value.runId].every(validId)) {
    throw recordError('RECORD_INPUT_INVALID', '运行记录参数无效');
  }
}

function validateListInput(input: RecordListInput): void {
  if (!input || typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some(key => !['operationId', 'agentId', 'since', 'until', 'limit', 'cursor'].includes(key))
    || ![input.operationId, input.agentId, input.since, input.until, input.cursor]
      .every(item => item === undefined || typeof item === 'string')
    || (input.operationId !== undefined && !validId(input.operationId))
    || (input.agentId !== undefined && !validId(input.agentId))
    || [input.since, input.until].some(item => item !== undefined && !Number.isFinite(Date.parse(item)))
    || (input.limit !== undefined && (!Number.isInteger(input.limit)
      || input.limit < 1 || input.limit > 50))) {
    throw recordError('RECORD_INPUT_INVALID', '运行记录参数无效');
  }
}

function validId(value: unknown): boolean {
  return typeof value === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

function validateReadInput(input: RecordReadInput): void {
  if (!input || typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).some(key => !['maxTextChars', 'maxTextLines', 'cursor'].includes(key))
    || (input.cursor !== undefined && typeof input.cursor !== 'string')
    || (input.maxTextChars !== undefined && (!Number.isInteger(input.maxTextChars)
      || input.maxTextChars < 1 || input.maxTextChars > 12_000))
    || (input.maxTextLines !== undefined && (!Number.isInteger(input.maxTextLines)
      || input.maxTextLines < 1 || input.maxTextLines > 200))) {
    throw recordError('RECORD_INPUT_INVALID', '运行记录参数无效');
  }
}

function encodeCursor(revision: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url');
}

function parseCursor(cursor: string, revision: string): number {
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error('format');
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      revision?: unknown; offset?: unknown;
    };
    if (parsed.revision !== revision || !Number.isSafeInteger(parsed.offset)
      || (parsed.offset as number) < 0) throw new Error('stale');
    return parsed.offset as number;
  } catch {
    throw recordError('RECORD_CURSOR_STALE', '记录游标已失效');
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function recordError(code: string, message: string) {
  const kind = ['RECORD_NOT_FOUND', 'FEATURE_RECORDS_UNAVAILABLE'].includes(code)
    ? 'not_found' : 'validation';
  return frameworkError({ code, kind, message,
    source: 'collaboration.records', retryable: false });
}
