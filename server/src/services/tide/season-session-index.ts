import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../engine/shared/atomic-io.js';

interface SeasonIndexMeta extends Record<string, unknown> {
  i: string;
  t: string;
  u: string;
  n?: string;
}

interface SeasonIndexSession {
  id: string;
  title: string;
  updatedAt: string;
  agentName: string;
}

function isMeta(value: unknown): value is SeasonIndexMeta {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Partial<SeasonIndexMeta>;
  return typeof meta.i === 'string'
    && typeof meta.t === 'string'
    && typeof meta.u === 'string';
}

function toMeta(session: SeasonIndexSession, current: SeasonIndexMeta = {} as SeasonIndexMeta): SeasonIndexMeta {
  return {
    ...current,
    i: session.id,
    t: session.title,
    u: session.updatedAt,
    ...(session.agentName ? { n: session.agentName } : {}),
  };
}

async function loadLegacyMeta(dir: string, sessionId: string): Promise<SeasonIndexMeta | null> {
  try {
    const session = JSON.parse(await fs.readFile(path.join(dir, `${sessionId}.json`), 'utf8')) as SeasonIndexSession;
    if (!session?.id || !session.title || !session.updatedAt) return null;
    return toMeta(session);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function updateSeasonSessionIndex(
  dir: string,
  session: SeasonIndexSession,
): Promise<void> {
  const file = path.join(dir, '_index.json');
  let entries: unknown[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    if (Array.isArray(parsed)) entries = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (entries.every(entry => typeof entry === 'string')) {
    const ids = [...new Set(entries as string[])];
    if (!ids.includes(session.id)) ids.push(session.id);
    await atomicWriteFile(file, JSON.stringify(ids, null, 2));
    return;
  }

  const metas = new Map<string, SeasonIndexMeta>();
  for (const entry of entries) {
    if (isMeta(entry)) metas.set(entry.i, entry);
  }
  for (const entry of entries) {
    if (typeof entry !== 'string' || metas.has(entry)) continue;
    const meta = entry === session.id ? toMeta(session) : await loadLegacyMeta(dir, entry);
    if (meta) metas.set(meta.i, meta);
  }
  metas.set(session.id, toMeta(session, metas.get(session.id)));
  await atomicWriteFile(file, JSON.stringify([...metas.values()], null, 2));
}
