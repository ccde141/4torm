import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { requireSeasonSessionPort, type SeasonSessionPort } from './season-session-port.js';
import { archiveTideSession } from './session-archive.js';
import { readSessionDir, readSessionJson, removeSessionPath, statSessionPath } from './session-io.js';
import { migrateOldTideSessions, updateTideSessionIndex } from './session-migration.js';
import { tideSessionRoot, tideTaskSessionDir } from './session-paths.js';
import type { ArchiveResult, TideMessage, TideSession } from './session-types.js';
import { readOwnedTideSession, type TideSessionOwner } from './session-reader.js';

export type { ArchiveResult, TideMessage, TideSession } from './session-types.js';

export async function readTideSession(
  dataDir: string,
  agentId: string,
  sessionId: string,
  owner?: TideSessionOwner,
): Promise<TideSession | null> {
  return readOwnedTideSession(dataDir, agentId, sessionId, owner);
}
export async function readSeasonSession(
  port: SeasonSessionPort | undefined,
  agentId: string,
  sessionId: string,
): Promise<TideSession | null> {
  return requireSeasonSessionPort(port).read(agentId, sessionId);
}

export async function writeTideSession(
  dataDir: string,
  session: TideSession,
  taskId: string,
  taskName: string,
): Promise<void> {
  await migrateOldTideSessions(dataDir, session.agentId, taskId, taskName);
  const dir = tideTaskSessionDir(dataDir, session.agentId, taskId, taskName);
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteFile(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
  await updateTideSessionIndex(dir, session.id);
}

export async function deleteTideSession(
  dataDir: string,
  agentId: string,
  sessionId: string,
  taskId: string,
  taskName: string,
): Promise<boolean> {
  await migrateOldTideSessions(dataDir, agentId, taskId, taskName);
  const dir = tideTaskSessionDir(dataDir, agentId, taskId, taskName);
  const deleted = await removeSessionPath(path.join(dir, `${sessionId}.json`));
  if (!deleted) return false;
  const file = path.join(dir, '_index.json');
  const index = await readSessionJson<string[]>(file, '潮汐会话索引');
  if (Array.isArray(index)) {
    await atomicWriteFile(file, JSON.stringify(index.filter(id => id !== sessionId), null, 2));
  }
  return true;
}

export async function deleteTaskSessionDir(
  dataDir: string,
  agentId: string,
  taskId: string,
  taskName: string,
): Promise<void> {
  await migrateOldTideSessions(dataDir, agentId, taskId, taskName);
  await removeSessionPath(tideTaskSessionDir(dataDir, agentId, taskId, taskName), { recursive: true });
}

export async function listTideSessions(dataDir: string, agentId: string): Promise<TideSession[]> {
  const root = tideSessionRoot(dataDir, agentId);
  const taskDirs = await readSessionDir(root, '潮汐根目录');
  if (!taskDirs) return [];
  const sessions: TideSession[] = [];
  for (const name of taskDirs) {
    const dir = path.join(root, name);
    if (name === 'bak' || !(await statSessionPath(dir, '潮汐任务目录'))?.isDirectory()) continue;
    await appendIndexedSessions(dir, sessions);
  }
  await appendIndexedSessions(root, sessions);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function archiveIfNeeded(
  dataDir: string,
  session: TideSession,
  roundSeq: number,
  windowN: number,
  batch: number,
  taskId: string,
  taskName: string,
): Promise<ArchiveResult> {
  return archiveTideSession(dataDir, session, roundSeq, windowN, batch, taskId, taskName, {
    writeActive: value => writeTideSession(dataDir, value, taskId, taskName),
  });
}

async function appendIndexedSessions(dir: string, output: TideSession[]): Promise<void> {
  const index = await readSessionJson<string[]>(path.join(dir, '_index.json'), '潮汐会话索引');
  if (!Array.isArray(index)) return;
  for (const id of index) {
    const session = await readSessionJson<TideSession>(path.join(dir, `${id}.json`), '潮汐会话');
    if (session) output.push(session);
  }
}
