import { createHash } from 'node:crypto';
import type { ObservationPage, ObservationQuery } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { projectProbes, type ProbeAudience, type ProbeItem } from '../../../shared/probes/public.js';
import type { ConvectionRuntimeSource, ConvectionSessionSnapshot } from '../domain/session-snapshot.js';

export class ConvectionSessionCatalog {
  constructor(private readonly source: ConvectionRuntimeSource) {}

  async observe(query: ObservationQuery, audience: ProbeAudience): Promise<ObservationPage> {
    const snapshots = (await this.source.snapshots()).sort(compareSnapshots);
    const probes = snapshots.map(toProbe);
    const revision = revisionOf(probes);
    const offset = decodeCursor(query.cursor, revision);
    const projection = projectProbes(probes.slice(offset, offset + query.limit), {
      audience, fields: query.fields, limit: query.limit,
      maxTextChars: query.maxTextChars, maxTextLines: query.maxTextLines,
    });
    const nextOffset = offset + projection.consumed;
    const truncated = nextOffset < probes.length;
    return {
      feature: 'convection', revision, items: projection.items, truncated,
      contentTruncated: projection.contentTruncated,
      ...(truncated ? { nextCursor: encodeCursor(revision, nextOffset) } : {}),
    };
  }
}

function toProbe(snapshot: ConvectionSessionSnapshot): ProbeItem {
  const active = snapshot.activeRound;
  const last = snapshot.lastRound;
  if (!active && last) return {
    operationId: snapshot.sessionId, title: snapshot.title, status: last.status,
    updatedAt: last.updatedAt, runId: last.runId, phase: last.round,
    ...(last.error ? { errorMessage: last.error } : {}),
  };
  return {
    operationId: snapshot.sessionId, title: snapshot.title,
    status: active ? 'running' : 'idle',
    updatedAt: active?.startedAt ?? snapshot.updatedAt,
    ...(active ? { runId: active.runId, phase: active.round } : {}),
  };
}

function compareSnapshots(left: ConvectionSessionSnapshot, right: ConvectionSessionSnapshot): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.sessionId.localeCompare(right.sessionId);
}

function revisionOf(probes: ProbeItem[]): string {
  return createHash('sha256').update(JSON.stringify(probes)).digest('hex').slice(0, 16);
}

function encodeCursor(revision: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url');
}

function decodeCursor(cursor: string | undefined, revision: string): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!isCursor(value)) throw new Error('invalid cursor');
    if (value.revision !== revision) throw cursorError('CONVECTION_CURSOR_STALE', '对流会话已变化，请重新读取');
    return value.offset;
  } catch (error) {
    if (hasCode(error, 'CONVECTION_CURSOR_STALE')) throw error;
    throw cursorError('CONVECTION_CURSOR_INVALID', '对流会话游标无效', error);
  }
}

function cursorError(code: string, message: string, cause?: unknown) {
  return frameworkError({
    code, kind: code.endsWith('STALE') ? 'conflict' : 'validation', message,
    source: 'convection.catalog', retryable: false,
  }, cause === undefined ? undefined : { cause });
}

function hasCode(value: unknown, code: string): boolean {
  return value instanceof Error && 'data' in value
    && (value as { data?: { code?: string } }).data?.code === code;
}

function isCursor(value: unknown): value is { revision: string; offset: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cursor = value as { revision?: unknown; offset?: unknown };
  return typeof cursor.revision === 'string'
    && Number.isSafeInteger(cursor.offset) && (cursor.offset as number) >= 0;
}
