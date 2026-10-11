/** Recoverable two-file commit for the Cyclone bulletin and its audit history. */
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../shared/atomic-io.js';
import { frameworkError } from '../shared/framework-error.js';
import type { Bulletin, BulletinChange, BulletinEntry } from './bulletin.js';

export const MAX_ENTRIES = 60;
export const MAX_TEXT = 1200;

export function emptyBulletin(): Bulletin { return { entries: [], updatedAt: 0 }; }
export function genEntryId(): string {
  return `b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function corrupt(label: string, cause?: unknown): Error {
  return frameworkError({ code: 'CYCLONE_BULLETIN_CORRUPT', kind: 'io',
    message: `${label}已损坏`, source: 'cyclone.bulletin', retryable: false },
  cause === undefined ? undefined : { cause });
}

/** Parse current entries and the legacy { content, updatedAt } format. */
export function parseBulletin(raw: string): Bulletin {
  let j: any;
  try { j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); }
  catch (error) { throw corrupt('公告板', error); }
  if (Array.isArray(j?.entries)) {
    if (j.entries.some((e: any) => !e || typeof e.text !== 'string')) throw corrupt('公告板');
    const entries: BulletinEntry[] = j.entries
      .slice(0, MAX_ENTRIES)
      .map((e: any) => ({
        id: String(e.id || genEntryId()),
        text: String(e.text).slice(0, MAX_TEXT),
        author: String(e.author || '人类'),
        updatedAt: Number(e.updatedAt) || 0,
      }));
    return { entries, updatedAt: Number(j.updatedAt) || 0 };
  }
  if (typeof j?.content === 'string') {
    const now = Number(j.updatedAt) || 0;
    return j.content.trim()
      ? { entries: [{ id: genEntryId(), text: j.content.slice(0, MAX_TEXT), author: '人类', updatedAt: now }], updatedAt: now }
      : emptyBulletin();
  }
  throw corrupt('公告板');
}

export function parseBulletinHistory(raw: string): BulletinChange[] {
  let j: any;
  try { j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); }
  catch (error) { throw corrupt('公告板历史', error); }
  if (!Array.isArray(j?.changes) || j.changes.some((change: any) =>
    !change || !Number.isSafeInteger(change.seq) || change.seq < 1)) {
    throw corrupt('公告板历史');
  }
  return j.changes;
}

type PairValidator = (first: string, second: string) => void;
interface PendingPair { version: 1; first: string; second: string }
const mutationQueues = new Map<string, Promise<unknown>>();

export function serializeCycloneFile<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(file) ?? Promise.resolve();
  const current = previous.then(action, action);
  mutationQueues.set(file, current);
  return current.finally(() => {
    if (mutationQueues.get(file) === current) mutationQueues.delete(file);
  });
}

function pendingError(cause?: unknown): Error {
  return frameworkError({ code: 'CYCLONE_PENDING_CORRUPT', kind: 'io',
    message: '气旋待恢复事务已损坏', source: 'cyclone.bulletin', retryable: false },
  cause === undefined ? undefined : { cause });
}

function parsePendingPair(raw: string, validate: PairValidator): PendingPair {
  let value: unknown;
  try { value = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); }
  catch (error) { throw pendingError(error); }
  const pair = value as Partial<PendingPair> | null;
  if (pair?.version !== 1 || typeof pair.first !== 'string' || typeof pair.second !== 'string') {
    throw pendingError();
  }
  validate(pair.first, pair.second);
  return pair as PendingPair;
}

async function finishPair(
  pending: string, first: string, second: string, pair: PendingPair,
): Promise<void> {
  await atomicWriteFile(first, pair.first);
  await atomicWriteFile(second, pair.second);
  await fs.rm(pending, { force: true });
}

export async function recoverCyclonePair(
  pending: string, first: string, second: string, validate: PairValidator,
): Promise<void> {
  let raw: string;
  try { raw = await fs.readFile(pending, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await finishPair(pending, first, second, parsePendingPair(raw, validate));
}

export async function commitCyclonePair(
  pending: string, first: string, second: string, firstData: string, secondData: string,
): Promise<void> {
  const pair: PendingPair = { version: 1, first: firstData, second: secondData };
  await fs.mkdir(path.dirname(pending), { recursive: true });
  await atomicWriteFile(pending, JSON.stringify(pair));
  await finishPair(pending, first, second, pair);
}

function atomicWriteSync(file: string, content: string): void {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { fsSync.writeFileSync(temporary, content); fsSync.renameSync(temporary, file); }
  catch (error) { try { fsSync.rmSync(temporary, { force: true }); } catch {} throw error; }
}

export function recoverCyclonePairSync(
  pending: string, first: string, second: string, validate: PairValidator,
): void {
  let raw: string;
  try { raw = fsSync.readFileSync(pending, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const pair = parsePendingPair(raw, validate);
  atomicWriteSync(first, pair.first);
  atomicWriteSync(second, pair.second);
  fsSync.rmSync(pending, { force: true });
}
