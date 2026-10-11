import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ObservationPage, ObservationQuery, ModuleAudience } from '../../../engine/collaboration/contracts.js';
import { projectProbes } from '../../../shared/probes/public.js';
import type { MonsoonRuntimeSnapshot } from '../runtime/session-registry.js';
import type { ProbeItem } from '../../../shared/probes/public.js';
import { loadSessionTitles, sessionTitle, type MonsoonTitleSource } from './title-projection.js';

export interface MonsoonSnapshotSource {
  snapshot(): MonsoonRuntimeSnapshot;
  findRun(sessionId: string, runId: string): ProbeItem | undefined;
}

export class MonsoonCatalog {
  constructor(private readonly source: MonsoonSnapshotSource,
    private readonly titles?: MonsoonTitleSource) {}

  async list(query: ObservationQuery, audience: ModuleAudience): Promise<ObservationPage> {
    const snapshot = this.source.snapshot();
    const offset = decodeCursor(query.cursor, snapshot.revision);
    const items = snapshot.items.slice(offset, offset + query.limit);
    const byAgent = await loadSessionTitles(items, this.titles);
    const named = items.map(item => ({ ...item,
      title: sessionTitle(item.agentId, item.operationId, item.title, byAgent) }));
    const projected = projectProbes(named, { ...query, audience });
    const nextOffset = offset + projected.consumed;
    const truncated = nextOffset < snapshot.items.length;
    return {
      feature: 'monsoon', revision: snapshot.revision, items: projected.items, truncated,
      contentTruncated: projected.contentTruncated,
      nextCursor: truncated ? encodeCursor(snapshot.revision, nextOffset) : undefined,
    };
  }
}

function encodeCursor(revision: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url');
}

function decodeCursor(cursor: string | undefined, revision: string): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (value.revision !== revision) throw staleCursor();
    if (!Number.isInteger(value.offset) || (value.offset as number) < 0) throw new Error('invalid');
    return value.offset as number;
  } catch (error) {
    if (hasCode(error, 'MONSOON_CURSOR_STALE')) throw error;
    throw frameworkError({
      code: 'MONSOON_CURSOR_INVALID', kind: 'validation', message: '季风状态游标无效',
      source: 'monsoon.catalog', retryable: false,
    }, { cause: error });
  }
}

function staleCursor() {
  return frameworkError({
    code: 'MONSOON_CURSOR_STALE', kind: 'conflict', message: '季风运行状态已变化，请重新读取',
    source: 'monsoon.catalog', retryable: false,
  });
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'data' in error
    && (error as { data?: { code?: string } }).data?.code === code;
}
