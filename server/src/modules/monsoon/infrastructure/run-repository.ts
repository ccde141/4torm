import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { monsoonRunsDir } from '../../../services/data-paths.js';
import { crashRun, parseMonsoonRunRecord, type MonsoonRunRecord } from '../domain/run-record.js';

export interface MonsoonRunRepository {
  save(record: MonsoonRunRecord): Promise<void>;
  load(): Promise<MonsoonRunRecord[]>;
  recover(updatedAt: string): Promise<{ records: MonsoonRunRecord[]; crashed: number }>;
}

export class FileMonsoonRunRepository implements MonsoonRunRepository {
  constructor(private readonly dataDir: string) {}

  async save(record: MonsoonRunRecord): Promise<void> {
    const parsed = parseMonsoonRunRecord(record);
    const dir = monsoonRunsDir(this.dataDir);
    await fs.mkdir(dir, { recursive: true });
    const currentFile = path.join(dir, runFileName(parsed.sessionId, parsed.runId));
    const legacyFile = path.join(dir, fileName(parsed.sessionId));
    const current = await readOptional(currentFile);
    const legacy = current ? null : await readOptional(legacyFile);
    const sameLegacy = legacy?.sessionId === parsed.sessionId && legacy.runId === parsed.runId;
    const file = sameLegacy ? legacyFile : currentFile;
    const saved = { ...parsed, createdAt: current?.createdAt
      ?? (sameLegacy ? legacy!.createdAt ?? legacy!.updatedAt : parsed.updatedAt) };
    await this.writeAt(file, saved);
  }

  async load(): Promise<MonsoonRunRecord[]> {
    const latest = new Map<string, MonsoonRunRecord>();
    for (const { record } of await this.readAll()) {
      const previous = latest.get(record.sessionId);
      if (!previous || compareRuns(record, previous) > 0) latest.set(record.sessionId, record);
    }
    return [...latest.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  }

  async history(): Promise<MonsoonRunRecord[]> {
    return (await this.readAll()).map(item => item.record)
      .sort((a, b) => compareRuns(a, b));
  }

  async getRun(sessionId: string, runId: string): Promise<MonsoonRunRecord | null> {
    const dir = monsoonRunsDir(this.dataDir);
    const current = await readOptional(path.join(dir, runFileName(sessionId, runId)));
    const legacy = current ?? await readOptional(path.join(dir, fileName(sessionId)));
    return legacy?.sessionId === sessionId && legacy.runId === runId ? legacy : null;
  }

  private async readAll(): Promise<Array<{ file: string; record: MonsoonRunRecord }>> {
    const dir = monsoonRunsDir(this.dataDir);
    let files: string[];
    try { files = (await fs.readdir(dir)).filter(file => file.endsWith('.json')).sort(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw repositoryError('MONSOON_RUNS_READ_FAILED', '无法读取季风运行记录', error);
    }
    const records: Array<{ file: string; record: MonsoonRunRecord }> = [];
    for (const name of files) {
      const file = path.join(dir, name);
      records.push({ file, record: await readRecord(file) });
    }
    return records;
  }

  async recover(updatedAt: string): Promise<{ records: MonsoonRunRecord[]; crashed: number }> {
    let crashed = 0;
    for (const { file, record } of await this.readAll()) {
      const recovered = crashRun(record, updatedAt);
      if (recovered !== record) {
        crashed++;
        await this.writeAt(file, recovered);
      }
    }
    return { records: await this.load(), crashed };
  }

  private async writeAt(file: string, record: MonsoonRunRecord): Promise<void> {
    await atomicWriteFile(file, JSON.stringify(record, null, 2));
  }
}

function fileName(sessionId: string): string {
  return `${createHash('sha256').update(sessionId).digest('hex')}.json`;
}

function runFileName(sessionId: string, runId: string): string {
  return `${createHash('sha256').update(sessionId).update('\0').update(runId).digest('hex')}.json`;
}

function compareRuns(left: MonsoonRunRecord, right: MonsoonRunRecord): number {
  return (left.createdAt ?? left.updatedAt).localeCompare(right.createdAt ?? right.updatedAt)
    || left.updatedAt.localeCompare(right.updatedAt) || left.runId.localeCompare(right.runId);
}

async function readOptional(file: string): Promise<MonsoonRunRecord | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw repositoryError('MONSOON_RUNS_READ_FAILED', '无法读取季风运行记录', error);
  }
  try {
    return parseMonsoonRunRecord(JSON.parse(raw));
  } catch (error) {
    throw repositoryError('MONSOON_RUN_RECORD_CORRUPT',
      '季风运行记录损坏', error, path.basename(file));
  }
}

async function readRecord(file: string): Promise<MonsoonRunRecord> {
  try { return parseMonsoonRunRecord(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) {
    throw repositoryError('MONSOON_RUN_RECORD_CORRUPT', '季风运行记录损坏', error, path.basename(file));
  }
}

function repositoryError(code: string, message: string, cause: unknown, file?: string) {
  return frameworkError({ code, kind: 'io', message, source: 'monsoon.run-repository',
    retryable: false, details: file ? { file } : undefined }, { cause });
}
