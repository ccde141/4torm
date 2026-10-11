import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { cycloneRuntimeDir } from '../../../services/data-paths.js';
import { OperationNotifier } from '../../../engine/collaboration/operation-notifier.js';
import type {
  CycloneExecutionSnapshot,
  CycloneRunSnapshot,
  CycloneRunStatus,
} from '../domain/operation-snapshot.js';

export class CycloneRunRepository {
  private readonly latestByOperation = new Map<string, CycloneRunSnapshot>();
  private readonly notifier = new OperationNotifier();
  private initializing: Promise<number> | null = null;
  private initialized = false;

  constructor(private readonly dataDir: string) {}

  async initialize(): Promise<number> {
    if (this.initialized) return 0;
    this.initializing ??= this.load();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  async start(input: CycloneExecutionSnapshot): Promise<CycloneRunSnapshot> {
    await this.initialize();
    const record: CycloneRunSnapshot = {
      ...parseExecution(input), status: 'running', updatedAt: input.startedAt,
    };
    await this.persist(record);
    this.latestByOperation.set(record.operationId, record);
    this.notifier.publish(record);
    return structuredClone(record);
  }

  async finish(
    operationId: string,
    runId: string,
    status: Exclude<CycloneRunStatus, 'running'>,
    error?: string,
    agentIds?: string[],
  ): Promise<CycloneRunSnapshot> {
    await this.initialize();
    const current = this.latestByOperation.get(identifier(operationId));
    if (!current || current.runId !== identifier(runId)) throw runChanged();
    const record: CycloneRunSnapshot = {
      ...current, status, updatedAt: new Date().toISOString(),
      ...(error ? { error: error.slice(0, 2_000) } : {}),
      ...(agentIds ? { agentIds: [...new Set(agentIds.map(identifier))] } : {}),
    };
    await this.persist(record);
    this.latestByOperation.set(operationId, record);
    this.notifier.publish(record);
    return structuredClone(record);
  }

  async latest(operationId: string): Promise<CycloneRunSnapshot | null> {
    await this.initialize();
    const record = this.latestByOperation.get(identifier(operationId));
    return record ? structuredClone(record) : null;
  }

  async get(operationId: string, runId: string): Promise<CycloneRunSnapshot | null> {
    await this.initialize();
    const operation = identifier(operationId);
    const run = identifier(runId);
    const current = await this.readOptional(runFile(this.dataDir, operation, run));
    if (current) {
      if (current.operationId !== operation || current.runId !== run) {
        throw storageError('CYCLONE_RUN_CORRUPT', '气旋运行记录身份不匹配');
      }
      return structuredClone(current);
    }
    const legacy = await this.readOptional(legacyRunFile(this.dataDir, operation));
    if (legacy && legacy.operationId !== operation) {
      throw storageError('CYCLONE_RUN_CORRUPT', '气旋运行记录身份不匹配');
    }
    return legacy?.runId === run ? structuredClone(legacy) : null;
  }

  async list(): Promise<CycloneRunSnapshot[]> {
    await this.initialize();
    return [...this.latestByOperation.values()]
      .sort((left, right) => left.operationId.localeCompare(right.operationId))
      .map(record => structuredClone(record));
  }

  async history(): Promise<CycloneRunSnapshot[]> {
    await this.initialize();
    let entries: string[];
    try {
      entries = await fs.readdir(cycloneRuntimeDir(this.dataDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw storageError('CYCLONE_RUNS_READ_FAILED', '气旋运行记录读取失败', error);
    }
    return Promise.all(entries.filter(name => name.endsWith('.json'))
      .map(name => this.read(path.join(cycloneRuntimeDir(this.dataDir), name))));
  }

  subscribe(operationId: string, runId: string, listener: () => void): () => void {
    return this.notifier.subscribe({ operationId, runId }, listener);
  }

  private async load(): Promise<number> {
    let entries: string[];
    try {
      entries = await fs.readdir(cycloneRuntimeDir(this.dataDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return 0;
      }
      throw storageError('CYCLONE_RUNS_READ_FAILED', '气旋运行记录读取失败', error);
    }
    let crashed = 0;
    for (const entry of entries.filter(name => name.endsWith('.json'))) {
      const file = path.join(cycloneRuntimeDir(this.dataDir), entry);
      const record = await this.read(file);
      if (record.status === 'running') {
        record.status = 'crashed';
        record.updatedAt = new Date().toISOString();
        record.error = '服务重启前执行未正常收口';
        await this.persistAt(file, record);
        crashed += 1;
      }
      const previous = this.latestByOperation.get(record.operationId);
      if (!previous || compareRuns(record, previous) > 0) {
        this.latestByOperation.set(record.operationId, record);
      }
    }
    this.initialized = true;
    return crashed;
  }

  private async read(file: string): Promise<CycloneRunSnapshot> {
    try {
      return parseRecord(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      throw storageError('CYCLONE_RUN_CORRUPT', '气旋运行记录无效', error);
    }
  }

  private async readOptional(file: string): Promise<CycloneRunSnapshot | null> {
    try {
      return parseRecord(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw storageError('CYCLONE_RUN_CORRUPT', '气旋运行记录无效', error);
    }
  }

  private async persist(record: CycloneRunSnapshot): Promise<void> {
    await this.persistAt(runFile(this.dataDir, record.operationId, record.runId), record);
  }

  private async persistAt(file: string, record: CycloneRunSnapshot): Promise<void> {
    try {
      await fs.mkdir(cycloneRuntimeDir(this.dataDir), { recursive: true });
      await atomicWriteFile(file, JSON.stringify(record, null, 2));
    } catch (error) {
      throw storageError('CYCLONE_RUN_WRITE_FAILED', '气旋运行记录写入失败', error);
    }
  }
}

function runFile(dataDir: string, operationId: string, runId: string): string {
  const name = createHash('sha256').update(operationId).update('\0').update(runId).digest('hex');
  return path.join(cycloneRuntimeDir(dataDir), `${name}.json`);
}

function legacyRunFile(dataDir: string, operationId: string): string {
  const name = createHash('sha256').update(operationId).digest('hex');
  return path.join(cycloneRuntimeDir(dataDir), `${name}.json`);
}

function compareRuns(left: CycloneRunSnapshot, right: CycloneRunSnapshot): number {
  return left.startedAt.localeCompare(right.startedAt)
    || left.updatedAt.localeCompare(right.updatedAt)
    || left.runId.localeCompare(right.runId);
}

function parseExecution(value: CycloneExecutionSnapshot): CycloneExecutionSnapshot {
  return parseRecord({ ...value, status: 'running', updatedAt: value.startedAt });
}

function parseRecord(value: unknown): CycloneRunSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record');
  const record = value as Partial<CycloneRunSnapshot>;
  const statuses: CycloneRunStatus[] = ['running', 'completed', 'aborted', 'failed', 'crashed'];
  const phases = ['seat-chat', 'seat-resume', 'seat-compact', 'chair-chat', 'room-intro', 'room-speak'];
  if (!identifier(record.operationId) || !identifier(record.runId)
    || !identifier(record.workshopId) || !identifier(record.targetId)
    || (record.targetKind !== 'seat' && record.targetKind !== 'room')
    || !record.phase || !phases.includes(record.phase)
    || !record.status || !statuses.includes(record.status)
    || !timestamp(record.startedAt) || !timestamp(record.updatedAt)
    || (record.error !== undefined && typeof record.error !== 'string')
    || (record.agentIds !== undefined && (!Array.isArray(record.agentIds)
      || record.agentIds.some(id => !identifier(id))))) throw new Error('fields');
  return record as CycloneRunSnapshot;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw storageError('CYCLONE_RUN_ID_INVALID', '气旋运行标识无效');
  }
  return value;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function runChanged() {
  return frameworkError({ code: 'CYCLONE_RUN_CHANGED', kind: 'conflict',
    message: '气旋运行已经变化', source: 'cyclone.runs', retryable: false });
}

function storageError(code: string, message: string, cause?: unknown) {
  return frameworkError({ code, kind: 'io', message,
    source: 'cyclone.runs', retryable: false }, cause === undefined ? undefined : { cause });
}
