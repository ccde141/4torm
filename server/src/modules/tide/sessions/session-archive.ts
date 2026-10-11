import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { tideTaskSessionDir } from './session-paths.js';
import type { ArchiveResult, TideSession } from './session-types.js';

export interface ArchiveDependencies {
  writeActive(session: TideSession): Promise<void>;
}

export async function archiveTideSession(
  dataDir: string,
  session: TideSession,
  roundSeq: number,
  windowN: number,
  batch: number,
  taskId: string,
  taskName: string,
  dependencies: ArchiveDependencies,
): Promise<ArchiveResult> {
  if (windowN === 1) {
    return archiveEveryRound(dataDir, session, roundSeq, batch, taskId, taskName, dependencies);
  }
  if (roundSeq < windowN) return unchanged(roundSeq, batch);
  return archiveHalfWindow(
    dataDir, session, roundSeq, windowN, batch, taskId, taskName, dependencies,
  );
}

async function archiveEveryRound(
  dataDir: string,
  session: TideSession,
  roundSeq: number,
  batch: number,
  taskId: string,
  taskName: string,
  dependencies: ArchiveDependencies,
): Promise<ArchiveResult> {
  if (session.messages.length === 0) return unchanged(roundSeq, batch);
  const name = `${session.id}_${formatDate(new Date())}_${roundSeq}.json.bak.${batch + 1}`;
  await writeArchive(dataDir, session, session.messages, taskId, taskName, name);
  session.messages = [];
  await dependencies.writeActive(session);
  return { archived: true, newRoundSeq: roundSeq, newBatch: batch + 1 };
}

async function archiveHalfWindow(
  dataDir: string,
  session: TideSession,
  roundSeq: number,
  windowN: number,
  batch: number,
  taskId: string,
  taskName: string,
  dependencies: ArchiveDependencies,
): Promise<ArchiveResult> {
  const half = windowN / 2;
  const cut = findRoundCut(session, half);
  const start = batch * half + 1;
  const name = `${session.id}_${formatDate(new Date())}_${start}-${start + half - 1}.json.bak.${batch + 1}`;
  await writeArchive(dataDir, session, session.messages.slice(0, cut), taskId, taskName, name);
  // Rolling retention owns which turns remain; an exact compaction marker must not
  // restore turns that this independent window has just archived.
  session.messages = session.messages.slice(cut).filter(message => message.type !== 'compact-marker');
  await dependencies.writeActive(session);
  return { archived: true, newRoundSeq: roundSeq - half, newBatch: batch + 1 };
}

async function writeArchive(
  dataDir: string,
  session: TideSession,
  messages: TideSession['messages'],
  taskId: string,
  taskName: string,
  name: string,
): Promise<void> {
  const dir = path.join(tideTaskSessionDir(dataDir, session.agentId, taskId, taskName), 'bak');
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteFile(path.join(dir, name), JSON.stringify({ ...session, messages }, null, 2));
}

function findRoundCut(session: TideSession, rounds: number): number {
  let users = 0;
  for (let index = 0; index < session.messages.length; index += 1) {
    if (session.messages[index].role !== 'user') continue;
    users += 1;
    if (users > rounds) return index;
  }
  return session.messages.length;
}

function unchanged(roundSeq: number, batch: number): ArchiveResult {
  return { archived: false, newRoundSeq: roundSeq, newBatch: batch };
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
