import { createHash } from 'node:crypto';
import { applyBulletinOps, readBulletin, type BulletinEntry } from '../../../engine/cyclone/bulletin.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneWorkshopService } from './workshop-service.js';

const MAX_ENTRIES = 60;
const MAX_TEXT = 1_200;

export class CycloneAgentBulletinService {
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dataDir: string,
    private readonly workshops: CycloneWorkshopService,
  ) {}

  async read(workshopId: string, limit = 20, cursor?: string) {
    await this.workshops.require(workshopId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ENTRIES) throw invalid();
    const board = await readBulletin(this.dataDir, workshopId);
    const revision = digest(board.entries);
    const offset = cursor === undefined ? 0 : parseCursor(cursor, revision);
    const items = board.entries.slice(offset, offset + limit);
    const next = offset + items.length;
    return { revision, total: board.entries.length, items,
      ...(next < board.entries.length ? { nextCursor: `${revision}:${next}` } : {}) };
  }

  post(workshopId: string, text: string, agentId: string,
    source: 'agent' | 'supervisor' = 'agent'): Promise<{ entry: BulletinEntry }> {
    return this.serialize(workshopId, async () => {
      if (!text.trim() || text.length > MAX_TEXT) throw invalid();
      await this.workshops.require(workshopId);
      const before = await readBulletin(this.dataDir, workshopId);
      if (before.entries.length >= MAX_ENTRIES) throw bulletinError(
        'CYCLONE_BULLETIN_FULL', 'conflict', '公告板已满，请人类整理后再追加');
      const author = source === 'supervisor' ? '工作室主管' : `Agent:${agentId}`;
      const after = await applyBulletinOps(this.dataDir, workshopId,
        [{ op: 'add', text, author }], author);
      const previousIds = new Set(before.entries.map(entry => entry.id));
      const entry = after.entries.find(item => !previousIds.has(item.id)
        && item.author === author && item.text === text.trim());
      if (!entry) throw bulletinError(
        'CYCLONE_BULLETIN_APPEND_CONFLICT', 'conflict', '公告未确认写入，请读取当前公告板');
      return { entry };
    });
  }

  private async serialize<T>(workshopId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(workshopId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.writes.set(workshopId, current);
    try { return await current; }
    finally { if (this.writes.get(workshopId) === current) this.writes.delete(workshopId); }
  }
}

function digest(entries: BulletinEntry[]): string {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

function parseCursor(cursor: string, revision: string): number {
  const match = /^([a-f0-9]{64}):(0|[1-9]\d*)$/.exec(cursor);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw invalid();
  if (match[1] !== revision) throw bulletinError(
    'CYCLONE_BULLETIN_CHANGED', 'conflict', '公告板已变化，请从第一页重新读取');
  return Number(match[2]);
}

function invalid() {
  return bulletinError('CYCLONE_BULLETIN_AGENT_INPUT_INVALID', 'validation',
    '气旋公告参数无效');
}

function bulletinError(code: string, kind: 'validation' | 'conflict', message: string) {
  return frameworkError({ code, kind, message, source: 'cyclone.agent-bulletin',
    retryable: false });
}
