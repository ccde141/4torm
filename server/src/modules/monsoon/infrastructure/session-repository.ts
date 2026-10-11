import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { agentSessionFile, agentSessionsDir } from '../../../services/data-paths.js';
import {
  parseMonsoonSession, sessionUnread, type MonsoonSession, type MonsoonTokenUsage,
  type SessionWriteMode,
} from '../domain/session.js';
import { readSessionProjection, sessionMeta, type SessionIndexEntry } from './session-index.js';

export class SessionRevisionConflictError extends Error {
  constructor(readonly current: MonsoonSession) {
    super('会话已被其他操作更新');
    this.name = 'SessionRevisionConflictError';
  }
}

const sessionQueues = new Map<string, Promise<unknown>>();

export class FileMonsoonSessionRepository {
  constructor(private readonly dataDir: string) {}

  get(agentId: string, sessionId: string): Promise<MonsoonSession | null> {
    return this.read(agentId, sessionId);
  }

  list(agentId: string): Promise<MonsoonSession[]> {
    return this.lock(agentId, () => this.readList(agentId));
  }

  titles(agentId: string): Promise<ReadonlyMap<string, string>> {
    return this.lock(agentId, async () => {
      const index = await this.readIndex(agentId);
      return new Map(index.flatMap(entry => typeof entry !== 'string'
        ? [[entry.i, entry.t] as const] : []));
    });
  }

  create(value: unknown): Promise<MonsoonSession> {
    const session = parseMonsoonSession(value);
    return this.lock(session.agentId, async () => {
      if (await this.read(session.agentId, session.id)) throw new Error('会话已经存在');
      const created = { ...session, revision: 1, messageRevision: 1 };
      await this.write(created);
      await this.upsertIndex(created);
      return created;
    });
  }

  replace(
    value: unknown, expectedRevision: number, mode: SessionWriteMode,
    options?: { clearTokenUsage?: boolean },
  ): Promise<MonsoonSession> {
    const incoming = parseMonsoonSession(value);
    return this.lock(incoming.agentId, async () => {
      const current = await this.read(incoming.agentId, incoming.id);
      if (!current) throw new Error('会话不存在');
      if (current.revision !== expectedRevision) throw new SessionRevisionConflictError(current);
      const merged = mode === 'rename' ? rename(current, incoming)
        : content(current, incoming, options?.clearTokenUsage === true);
      const saved = { ...merged, revision: current.revision + 1,
        messageRevision: current.messageRevision + (mode === 'content' ? 1 : 0),
        updatedAt: new Date().toISOString() };
      saved.unreadCount = sessionUnread(saved);
      await this.write(saved);
      await this.upsertIndex(saved);
      return saved;
    });
  }

  /** Usage is a live observation, so updating it must not invalidate a pending message save. */
  updateTokenUsage(
    agentId: string, sessionId: string, usage: MonsoonTokenUsage | null,
    expectedRevision?: number,
  ): Promise<MonsoonSession> {
    return this.lock(agentId, async () => {
      const current = await this.read(agentId, sessionId);
      if (!current) throw new Error('会话不存在');
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new SessionRevisionConflictError(current);
      }
      const updated = { ...current };
      if (usage) updated.tokenUsage = usage; else delete updated.tokenUsage;
      const validated = parseMonsoonSession(updated, { agentId, sessionId });
      await this.write(validated);
      await this.upsertIndex(validated);
      return validated;
    });
  }

  delete(agentId: string, sessionId: string): Promise<boolean> {
    return this.lock(agentId, async () => {
      const current = await this.read(agentId, sessionId);
      if (!current) return false;
      const dir = agentSessionsDir(this.dataDir, agentId);
      await Promise.all([
        fs.rm(agentSessionFile(this.dataDir, agentId, sessionId), { force: true }),
        fs.rm(path.join(dir, `${sessionId}.taskboard.json`), { force: true }),
        fs.rm(path.join(dir, `${sessionId}.attachments`), { recursive: true, force: true }),
        fs.rm(path.join(dir, `${sessionId}.inputs`), { recursive: true, force: true }),
        fs.rm(path.join(dir, `${sessionId}.team`), { recursive: true, force: true }),
        fs.rm(path.join(dir, `${sessionId}.runs`), { recursive: true, force: true }),
        fs.rm(path.join(dir, `${sessionId}.compactions`), { recursive: true, force: true }),
      ]);
      await this.removeIndex(agentId, sessionId);
      return true;
    });
  }

  private async read(agentId: string, sessionId: string): Promise<MonsoonSession | null> {
    try {
      const raw = JSON.parse(await fs.readFile(agentSessionFile(this.dataDir, agentId, sessionId), 'utf8'));
      return parseMonsoonSession(raw, { agentId, sessionId });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readList(agentId: string): Promise<MonsoonSession[]> {
    const index = await this.readIndex(agentId);
    const sessions: MonsoonSession[] = [];
    for (const entry of index) {
      const id = typeof entry === 'string' ? entry : entry.i;
      const session = await this.read(agentId, id);
      if (session) sessions.push(session);
    }
    const ordered = sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return ordered.map(summary);
  }

  private async write(session: MonsoonSession): Promise<void> {
    const dir = agentSessionsDir(this.dataDir, session.agentId);
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteFile(agentSessionFile(this.dataDir, session.agentId, session.id),
      JSON.stringify(session, null, 2));
  }

  private async upsertIndex(session: MonsoonSession): Promise<void> {
    const sessions = await this.readAllIndexed(session.agentId, false);
    const index = sessions.findIndex(item => item.id === session.id);
    if (index >= 0) sessions[index] = session; else sessions.push(session);
    sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    await this.writeIndex(session.agentId, sessions.map(sessionMeta));
  }

  private async removeIndex(agentId: string, sessionId: string): Promise<void> {
    const sessions = await this.readAllIndexed(agentId, false);
    await this.writeIndex(agentId, sessions.filter(item => item.id !== sessionId).map(sessionMeta));
  }

  private async readAllIndexed(agentId: string, persistRecovery = true): Promise<MonsoonSession[]> {
    const index = await this.readIndex(agentId, persistRecovery);
    const values = await Promise.all(index.map(entry => this.read(agentId,
      typeof entry === 'string' ? entry : entry.i)));
    return values.filter((value): value is MonsoonSession => value !== null);
  }

  private async readIndex(agentId: string, persistRecovery = true): Promise<SessionIndexEntry[]> {
    const projection = await readSessionProjection(this.dataDir, agentId, id => this.read(agentId, id));
    if (persistRecovery && projection.recovered) await this.writeIndex(agentId, projection.entries);
    return projection.entries;
  }

  private async writeIndex(agentId: string, value: SessionIndexEntry[]): Promise<void> {
    await fs.mkdir(agentSessionsDir(this.dataDir, agentId), { recursive: true });
    await atomicWriteFile(this.indexFile(agentId), JSON.stringify(value, null, 2));
  }

  private indexFile(agentId: string): string {
    return path.join(agentSessionsDir(this.dataDir, agentId), '_index.json');
  }

  private lock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const identity = path.resolve(this.dataDir, 'agents', key);
    const previous = sessionQueues.get(identity);
    const pending = previous ? previous.then(work, work) : Promise.resolve().then(work);
    sessionQueues.set(identity, pending);
    return pending.finally(() => {
      if (sessionQueues.get(identity) === pending) sessionQueues.delete(identity);
    });
  }
}

function content(
  current: MonsoonSession, incoming: MonsoonSession, clearTokenUsage: boolean,
): MonsoonSession {
  const merged = { ...incoming, title: current.title, titleManual: current.titleManual,
    titleState: current.titleState, createdAt: current.createdAt };
  if (clearTokenUsage || current.tokenUsage === undefined) delete merged.tokenUsage;
  else merged.tokenUsage = current.tokenUsage;
  return merged;
}

function rename(current: MonsoonSession, incoming: MonsoonSession): MonsoonSession {
  return { ...current, title: incoming.title, titleManual: incoming.titleManual,
    titleState: incoming.titleState };
}

function summary(session: MonsoonSession): MonsoonSession {
  return { ...session, messages: [] };
}
