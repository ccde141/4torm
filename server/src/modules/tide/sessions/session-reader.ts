import path from 'node:path';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { ambiguousTideSession, readSessionDir, readSessionJson, statSessionPath } from './session-io.js';
import { tideSessionRoot, tideTaskSessionDir } from './session-paths.js';
import type { TideSession } from './session-types.js';
import { assertLegacySessionOwnership } from './legacy-session-ownership.js';

export interface TideSessionOwner { id: string; name: string }

/** A running task must supply its owner; unscoped UI reads reject ambiguous legacy IDs. */
export async function readOwnedTideSession(dataDir: string, agentId: string, sessionId: string,
  owner?: TideSessionOwner): Promise<TideSession | null> {
  if (owner) return readDirectorySession(
    tideTaskSessionDir(dataDir, agentId, owner.id, owner.name), agentId, sessionId);
  const root = tideSessionRoot(dataDir, agentId);
  const matches: TideSession[] = [];
  for (const name of await readSessionDir(root, '潮汐根目录') ?? []) {
    if (name === 'bak') continue;
    const dir = path.join(root, name);
    if (!(await statSessionPath(dir, '潮汐任务目录'))?.isDirectory()) continue;
    const session = await readDirectorySession(dir, agentId, sessionId);
    if (session) matches.push(session);
  }
  const legacy = await readDirectorySession(root, agentId, sessionId);
  if (legacy) {
    await assertLegacySessionOwnership(dataDir, agentId, sessionId);
    matches.push(legacy);
  }
  if (matches.length > 1) throw ambiguousTideSession(sessionId);
  return matches[0] ?? null;
}

async function readDirectorySession(dir: string, agentId: string,
  sessionId: string): Promise<TideSession | null> {
  const active = await readSessionJson<TideSession>(path.join(dir, `${sessionId}.json`), '潮汐会话');
  const session = active ?? await readLatestArchive(dir, sessionId);
  if (session && (session.id !== sessionId || session.agentId !== agentId)) {
    throw frameworkError({ code: 'TIDE_SESSION_IDENTITY_MISMATCH', kind: 'protocol',
      message: '潮汐会话身份与存储位置不一致', source: 'tide.sessions', retryable: false });
  }
  return session;
}

async function readLatestArchive(dir: string, sessionId: string): Promise<TideSession | null> {
  const archiveDir = path.join(dir, 'bak');
  const candidates: Array<{ file: string; mtime: number }> = [];
  for (const name of await readSessionDir(archiveDir, '潮汐归档目录') ?? []) {
    if (!name.startsWith(`${sessionId}_`) && !name.startsWith(`${sessionId}.json.bak.`)) continue;
    const file = path.join(archiveDir, name);
    const stat = await statSessionPath(file, '潮汐归档文件');
    if (stat?.isFile()) candidates.push({ file, mtime: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime || b.file.localeCompare(a.file));
  return candidates[0] ? readSessionJson<TideSession>(candidates[0].file, '潮汐归档会话') : null;
}
