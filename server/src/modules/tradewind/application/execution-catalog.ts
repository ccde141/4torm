import { createHash } from 'node:crypto';
import type { ObservationPage, ObservationQuery } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { projectProbes, type ProbeAudience, type ProbeItem } from '../../../shared/probes/public.js';
import type { TradewindExecutionSnapshot, TradewindRuntimeSource } from '../domain/execution-snapshot.js';

export class TradewindExecutionCatalog {
  constructor(private readonly source: TradewindRuntimeSource) {}

  async observe(
    query: ObservationQuery,
    audience: ProbeAudience,
  ): Promise<ObservationPage> {
    const probes = (await this.source.snapshots()).map(toProbe);
    const revision = revisionOf(probes);
    const offset = decodeCursor(query.cursor, revision);
    const projection = projectProbes(probes.slice(offset, offset + query.limit), {
      audience, fields: query.fields, limit: query.limit,
      maxTextChars: query.maxTextChars, maxTextLines: query.maxTextLines,
    });
    const nextOffset = offset + projection.consumed;
    const truncated = nextOffset < probes.length;
    return { feature: 'tradewind', revision, items: projection.items, truncated,
      contentTruncated: projection.contentTruncated,
      ...(truncated ? { nextCursor: encodeCursor(revision, nextOffset) } : {}),
    };
  }
}

function toProbe(snapshot: TradewindExecutionSnapshot): ProbeItem {
  return {
    operationId: snapshot.operationId, title: snapshot.title, status: snapshot.status,
    ...(snapshot.parentOperationId ? { parentOperationId: snapshot.parentOperationId } : {}),
    ...(snapshot.runId ? { runId: snapshot.runId } : {}),
    ...(snapshot.phase ? { phase: snapshot.phase } : {}),
    ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
    ...(snapshot.waitingReason ? { waitingReason: snapshot.waitingReason } : {}),
    ...(snapshot.errorCode ? { errorCode: snapshot.errorCode } : {}),
    ...(snapshot.errorMessage ? { errorMessage: snapshot.errorMessage } : {}),
    ...(snapshot.resultSummary ? { resultSummary: snapshot.resultSummary } : {}),
  };
}

function encodeCursor(revision: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url');
}

function decodeCursor(cursor: string | undefined, revision: string): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!isCursor(value)) throw new Error('invalid cursor');
    if (value.revision !== revision) throw cursorError('TRADEWIND_CURSOR_STALE', '信风状态已变化，请重新读取');
    return value.offset;
  } catch (error) {
    if (hasCode(error, 'TRADEWIND_CURSOR_STALE')) throw error;
    throw cursorError('TRADEWIND_CURSOR_INVALID', '信风状态游标无效', error);
  }
}

function cursorError(code: string, message: string, cause?: unknown) {
  return frameworkError({ code, kind: code.endsWith('STALE') ? 'conflict' : 'validation',
    message, source: 'tradewind.catalog', retryable: false,
  }, cause === undefined ? undefined : { cause });
}

function hasCode(value: unknown, code: string): boolean {
  return value instanceof Error && 'data' in value
    && (value as { data?: { code?: string } }).data?.code === code;
}

function isCursor(value: unknown): value is { revision: string; offset: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as { revision?: unknown; offset?: unknown };
  return typeof record.revision === 'string'
    && Number.isSafeInteger(record.offset) && (record.offset as number) >= 0;
}

function revisionOf(probes: ProbeItem[]): string {
  return createHash('sha256').update(JSON.stringify(probes)).digest('hex').slice(0, 16);
}
