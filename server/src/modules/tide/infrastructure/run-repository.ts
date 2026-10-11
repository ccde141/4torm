import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { tideRunsDir } from '../../../services/data-paths.js';
import { parseTideRunRecord, type TideRunRecord } from '../domain/run.js';
import type { TideChangeFeed } from '../application/change-feed.js';

export interface TideRunRepository {
  save(record: TideRunRecord): Promise<void>;
  get(taskId: string, runId: string): Promise<TideRunRecord | null>;
  list(taskId: string, limit: number): Promise<TideRunRecord[]>;
  removeTask(taskId: string): Promise<void>;
}

export class FileTideRunRepository implements TideRunRepository {
  constructor(private readonly dataDir: string, private readonly changes?: TideChangeFeed) {}

  async save(record: TideRunRecord): Promise<void> {
    parseTideRunRecord(record);
    const dir = tideRunsDir(this.dataDir, record.taskId);
    await fs.mkdir(dir, { recursive: true });
    const safeTimestamp = record.timestamp.replace(/:/g, '-');
    const suffix = record.runId ? `-${runIdentifier(record.runId)}` : '';
    await atomicWriteFile(path.join(dir, `${safeTimestamp}${suffix}.json`),
      JSON.stringify(record, null, 2));
    this.changes?.publish({ scope: 'record', taskId: record.taskId, runId: record.runId });
  }

  async get(taskId: string, runId: string): Promise<TideRunRecord | null> {
    const files = await listJsonFiles(tideRunsDir(this.dataDir, taskId));
    const name = files.find(file => file.endsWith(`-${runIdentifier(runId)}.json`));
    if (!name) return null;
    const record = await readRunRecord(path.join(tideRunsDir(this.dataDir, taskId), name));
    if (record.taskId !== taskId || record.runId !== runId) throw frameworkError({
      code: 'TIDE_RUN_RECORD_CORRUPT', kind: 'protocol',
      message: '潮汐运行记录身份不匹配', source: 'tide.run-repository', retryable: false,
    });
    return record;
  }

  async list(taskId: string, limit: number): Promise<TideRunRecord[]> {
    const dir = tideRunsDir(this.dataDir, taskId);
    const files = await listJsonFiles(dir);
    const records: TideRunRecord[] = [];
    for (const file of files.slice(0, Math.max(0, Math.min(limit, 100)))) {
      records.push(await readRunRecord(path.join(dir, file)));
    }
    return records;
  }

  async removeTask(taskId: string): Promise<void> {
    await fs.rm(tideRunsDir(this.dataDir, taskId), { recursive: true, force: true });
  }
}

function runIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw frameworkError({
    code: 'TIDE_RUN_ID_INVALID', kind: 'validation',
    message: '潮汐运行标识无效', source: 'tide.run-repository', retryable: false,
  });
  return value;
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter(name => name.endsWith('.json')).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw frameworkError({
      code: 'TIDE_RUNS_READ_FAILED', kind: 'io',
      message: '无法读取潮汐运行记录', source: 'tide.run-repository', retryable: false,
    }, { cause: error });
  }
}

async function readRunRecord(file: string): Promise<TideRunRecord> {
  try {
    return parseTideRunRecord(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    throw frameworkError({
      code: 'TIDE_RUN_RECORD_CORRUPT', kind: 'protocol',
      message: '潮汐运行记录损坏', source: 'tide.run-repository', retryable: false,
      details: { file: path.basename(file) },
    }, { cause: error });
  }
}
