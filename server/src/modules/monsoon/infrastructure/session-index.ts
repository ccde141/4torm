import fs from 'node:fs/promises';
import path from 'node:path';
import { agentSessionsDir } from '../../../services/data-paths.js';
import { sessionSourceVersion, type MonsoonSession } from '../domain/session.js';
import { parseMonsoonSession } from '../domain/session.js';
import type { CurrentInputEstimate } from '../../../engine/shared/model-request-usage.js';

type SessionSummary = Omit<MonsoonSession, 'messages' | 'systemPrompt' | 'masterPrompt' | 'rolePrompt'>;

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
  cp?: number;
  sv?: string;
  /** Header projection only: transcripts and prompts stay in the primary file. */
  d?: SessionSummary;
  f?: string;
  ce?: CurrentInputEstimate;
}

export type SessionIndexEntry = SessionMeta | string;

/** Primary files are facts; the index is a recoverable projection, never a corruption fallback. */
export async function readSessionProjection(
  dataDir: string, agentId: string,
  read: (sessionId: string) => Promise<MonsoonSession | null>,
  replacing?: MonsoonSession,
): Promise<{ entries: SessionIndexEntry[]; recovered: boolean }> {
  const dir = agentSessionsDir(dataDir, agentId);
  const entries = await readIndex(path.join(dir, '_index.json'));
  let files: string[];
  try { files = await fs.readdir(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], recovered: false };
    throw error;
  }
  const known = new Map(entries.map(entry => [typeof entry === 'string' ? entry : entry.i, entry]));
  let recovered = false;
  const primary = files.filter(file => file.endsWith('.json') && file !== '_index.json'
    && !file.endsWith('.taskboard.json')).sort();
  const projected: SessionIndexEntry[] = [];
  // Bound legacy recovery so opening an Agent cannot parse all large histories concurrently.
  for (let offset = 0; offset < primary.length; offset += 4) {
    const batch = await Promise.all(primary.slice(offset, offset + 4).map(async file => {
      const id = file.slice(0, -5);
      if (!identifier(id)) throw new Error('会话主文件标识无效');
      if (id === replacing?.id) return known.get(id) ?? sessionMeta(replacing);
      const fingerprint = await sessionFingerprint(path.join(dir, file));
      const cached = known.get(id);
      if (cached && typeof cached !== 'string' && cached.d?.agentId === agentId
        && cached.f && cached.f === fingerprint) return cached;
      const session = await read(id); // The repository parser checks owner and filename identity.
      recovered = true;
      if (!session) return undefined;
      const after = await sessionFingerprint(path.join(dir, file));
      return sessionMeta(session, fingerprint === after ? after : undefined);
    }));
    projected.push(...batch.filter((entry): entry is SessionMeta => entry !== undefined));
  }
  return { entries: projected, recovered: recovered || projected.length !== entries.length };
}

export async function sessionFingerprint(file: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(file, { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
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
  for (const field of ['n', 'r', 'sv', 'f'] as const) {
    if (entry[field] !== undefined && typeof entry[field] !== 'string') return false;
  }
  for (const field of ['un', 'rv', 'tk', 'pt', 'ct', 'cp'] as const) {
    const number = entry[field];
    if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number)
      || number < 0)) return false;
  }
  if (entry.d !== undefined) {
    try { parseMonsoonSession({ ...entry.d as object, messages: [], systemPrompt: '' }, { sessionId: entry.i }); }
    catch { return false; }
  }
  if (entry.ce !== undefined && !validEstimate(entry.ce)) return false;
  return true;
}

function validEstimate(value: unknown): value is CurrentInputEstimate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as CurrentInputEstimate;
  return Number.isSafeInteger(entry.tokens) && entry.tokens >= 0
    && Number.isSafeInteger(entry.images) && entry.images >= 0
    && typeof entry.model === 'string' && Number.isFinite(Date.parse(entry.estimatedAt));
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

export function sessionMeta(session: MonsoonSession, fingerprint?: string): SessionMeta {
  const { messages, systemPrompt: _system, masterPrompt: _master, rolePrompt: _role, ...header } = session;
  return { i: session.id, t: session.title, u: session.updatedAt, n: session.agentName,
    r: session.lastReadAt, un: session.unreadCount, rv: session.revision,
    tk: session.tokenUsage?.totalTokens, pt: session.tokenUsage?.promptTokens,
    ct: session.tokenUsage?.completionTokens,
    cp: messages.filter(message => message.type === 'compact-marker').length, sv: sessionSourceVersion(session),
    d: header, f: fingerprint };
}

export function sessionSummary(entry: SessionMeta): MonsoonSession & { currentInput?: CurrentInputEstimate } {
  if (!entry.d) throw new Error('会话索引缺少摘要');
  return { ...entry.d, systemPrompt: '', messages: [], ...(entry.ce ? { currentInput: entry.ce } : {}) };
}
