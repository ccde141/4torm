import { createHash } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { SeasonSessionPort } from '../sessions/season-session-port.js';

/** Explicit Tide → Monsoon session-read adapter for designated delivery. */
export class TideTargetSessions {
  private readonly sessions: SeasonSessionPort;
  constructor(dataDir: string) {
    this.sessions = new SeasonSessionPort(dataDir);
  }

  async list(agentId: string, cursor?: string) {
    const all = await this.sessions.list(agentId);
    const revision = createHash('sha256').update(JSON.stringify(
      all.map(session => [session.id, session.revision]),
    )).digest('hex').slice(0, 16);
    const offset = cursor ? decode(cursor, revision) : 0;
    const items = all.slice(offset, offset + 20).map(session => ({
      id: session.id, agentId: session.agentId, title: session.title,
      updatedAt: session.updatedAt,
    }));
    const next = offset + items.length;
    return { agentId, items, truncated: next < all.length,
      ...(next < all.length ? { nextCursor: encode(revision, next) } : {}) };
  }
}

function encode(revision: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url');
}

function decode(cursor: string, revision: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      revision?: unknown; offset?: unknown;
    };
    if (parsed.revision === revision && Number.isSafeInteger(parsed.offset)
      && (parsed.offset as number) >= 0) return parsed.offset as number;
  } catch { /* reported below */ }
  throw frameworkError({ code: 'TIDE_TARGET_CURSOR_STALE', kind: 'conflict',
    message: '季风会话列表已变化，请从第一页重新读取',
    source: 'tide.targets', retryable: false });
}
