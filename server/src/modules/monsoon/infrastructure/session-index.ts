import fs from 'node:fs/promises';
import path from 'node:path';
import { agentSessionsDir } from '../../../services/data-paths.js';
import type { MonsoonSession } from '../domain/session.js';

export interface SessionMeta {
  i: string;
  t: string;
  u: string;
  n?: string;
  r?: string;
  un?: number;
  rv?: number;
  tk?: number;
  pt?: number;
  ct?: number;
}

export type SessionIndexEntry = SessionMeta | string;

/** Primary files are facts; the index is a recoverable projection, never a corruption fallback. */
export async function readSessionProjection(
  dataDir: string, agentId: string,
  read: (sessionId: string) => Promise<MonsoonSession | null>,
): Promise<{ entries: SessionIndexEntry[]; recovered: boolean }> {
  const dir = agentSessionsDir(dataDir, agentId);
  const entries = await readIndex(path.join(dir, '_index.json'));
  let files: string[];
  try { files = await fs.readdir(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries, recovered: false };
    throw error;
  }
  const known = new Set(entries.map(entry => typeof entry === 'string' ? entry : entry.i));
  let recovered = false;
  for (const file of files.sort()) {
    if (!file.endsWith('.json') || file === '_index.json' || file.endsWith('.taskboard.json')) continue;
    const id = file.slice(0, -5);
    if (known.has(id)) continue;
    if (!identifier(id)) throw new Error('会话主文件标识无效');
    const session = await read(id); // The repository parser also checks owner and filename identity.
    if (session) { entries.push(sessionMeta(session)); recovered = true; }
  }
  return { entries, recovered };
}

async function readIndex(file: string): Promise<SessionIndexEntry[]> {
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!Array.isArray(value)) throw new Error('会话索引无效');
  const ids = new Set<string>();
  for (const entry of value) {
    if (!validEntry(entry)) throw new Error('会话索引无效');
    const id = typeof entry === 'string' ? entry : entry.i;
    if (ids.has(id)) throw new Error('会话索引包含重复标识');
    ids.add(id);
  }
  return value;
}

function validEntry(value: unknown): value is SessionIndexEntry {
  if (typeof value === 'string') return identifier(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (!identifier(entry.i) || typeof entry.t !== 'string' || typeof entry.u !== 'string'
    || !Number.isFinite(Date.parse(entry.u))) return false;
  for (const field of ['n', 'r'] as const) {
    if (entry[field] !== undefined && typeof entry[field] !== 'string') return false;
  }
  for (const field of ['un', 'rv', 'tk', 'pt', 'ct'] as const) {
    const number = entry[field];
    if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number)
      || number < 0)) return false;
  }
  return true;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

export function sessionMeta(session: MonsoonSession): SessionMeta {
  return { i: session.id, t: session.title, u: session.updatedAt, n: session.agentName,
    r: session.lastReadAt, un: session.unreadCount, rv: session.revision,
    tk: session.tokenUsage?.totalTokens, pt: session.tokenUsage?.promptTokens,
    ct: session.tokenUsage?.completionTokens };
}
