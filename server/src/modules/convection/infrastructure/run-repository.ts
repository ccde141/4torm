import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { convectionRunFile, convectionRunsDir } from '../../../services/data-paths.js';
import { OperationNotifier } from '../../../engine/collaboration/operation-notifier.js';
import type {
  ConvectionRoundKind,
  ConvectionRunSnapshot,
  ConvectionRunStatus,
} from '../domain/session-snapshot.js';

interface StartRunInput {
  sessionId: string;
  runId: string;
  round: ConvectionRoundKind;
  startedAt: string;
}

export class ConvectionRunRepository {
  private readonly latestBySession = new Map<string, ConvectionRunSnapshot>();
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

  async start(input: StartRunInput): Promise<ConvectionRunSnapshot> {
    await this.initialize();
    const sessionId = identifier(input.sessionId);
    const runId = identifier(input.runId);
    if (!timestamp(input.startedAt)) throw storageError(
      'CONVECTION_RUN_TIMESTAMP_INVALID', '对流轮次时间无效',
    );
    const now = input.startedAt;
    const record: ConvectionRunSnapshot = {
      ...input, sessionId, runId, status: 'running', updatedAt: now,
    };
    await this.persist(record);
    this.latestBySession.set(sessionId, record);
    this.notifier.publish({ operationId: sessionId, runId });
    return structuredClone(record);
  }

  async finish(
    sessionId: string,
    runId: string,
    status: Exclude<ConvectionRunStatus, 'running'>,
    error?: string,
    agentIds?: string[],
  ): Promise<ConvectionRunSnapshot> {
    await this.initialize();
    const current = this.latestBySession.get(identifier(sessionId));
    if (!current || current.runId !== identifier(runId)) throw runChanged();
    const record: ConvectionRunSnapshot = {
      ...current, status, updatedAt: new Date().toISOString(),
      ...(error ? { error: error.slice(0, 2_000) } : {}),
      ...(agentIds ? { agentIds: [...new Set(agentIds.map(identifier))] } : {}),
    };
    await this.persist(record);
    this.latestBySession.set(sessionId, record);
    this.notifier.publish({ operationId: sessionId, runId });
    return structuredClone(record);
  }

  async latest(sessionId: string): Promise<ConvectionRunSnapshot | null> {
    await this.initialize();
    const value = this.latestBySession.get(identifier(sessionId));
    return value ? structuredClone(value) : null;
  }

  async get(sessionId: string, runId: string): Promise<ConvectionRunSnapshot | null> {
    await this.initialize();
    const session = identifier(sessionId);
    const run = identifier(runId);
    const current = await this.readOptional(convectionRunFile(this.dataDir, session, run));
    if (current) {
      if (current.sessionId !== session || current.runId !== run) throw storageError(
        'CONVECTION_RUN_CORRUPT', '对流轮次记录身份不匹配');
      return structuredClone(current);
    }
    const legacy = await this.readOptional(convectionRunFile(this.dataDir, session));
    if (legacy && legacy.sessionId !== session) throw storageError(
      'CONVECTION_RUN_CORRUPT', '对流轮次记录身份不匹配');
    return legacy?.runId === run ? structuredClone(legacy) : null;
  }

  async history(): Promise<ConvectionRunSnapshot[]> {
    await this.initialize();
    let entries: string[];
    try {
      entries = await fs.readdir(convectionRunsDir(this.dataDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw storageError('CONVECTION_RUNS_READ_FAILED', '对流轮次记录读取失败', error);
    }
    return Promise.all(entries.filter(name => name.endsWith('.json'))
      .map(name => this.read(path.join(convectionRunsDir(this.dataDir), name))));
  }

  subscribe(sessionId: string, runId: string, listener: () => void): () => void {
    return this.notifier.subscribe({ operationId: sessionId, runId }, listener);
  }

  private async load(): Promise<number> {
    let entries: string[];
    try {
      entries = await fs.readdir(convectionRunsDir(this.dataDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return 0;
      }
      throw storageError('CONVECTION_RUNS_READ_FAILED', '对流轮次记录读取失败', error);
    }
    let crashed = 0;
    for (const entry of entries.filter(name => name.endsWith('.json'))) {
      const file = path.join(convectionRunsDir(this.dataDir), entry);
      const record = await this.read(file);
      if (record.status === 'running') {
        record.status = 'crashed';
        record.updatedAt = new Date().toISOString();
        record.error = '服务重启前轮次未正常收口';
        await this.persistAt(file, record);
        crashed += 1;
      }
      const previous = this.latestBySession.get(record.sessionId);
      if (!previous || compareRuns(record, previous) > 0) {
        this.latestBySession.set(record.sessionId, record);
      }
    }
    this.initialized = true;
    return crashed;
  }

  private async read(file: string): Promise<ConvectionRunSnapshot> {
    try {
      return parseRecord(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      throw storageError('CONVECTION_RUN_CORRUPT', '对流轮次记录无效', error);
    }
  }

  private async readOptional(file: string): Promise<ConvectionRunSnapshot | null> {
    try {
      return parseRecord(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw storageError('CONVECTION_RUN_CORRUPT', '对流轮次记录无效', error);
    }
  }

  private async persist(record: ConvectionRunSnapshot): Promise<void> {
    await this.persistAt(convectionRunFile(this.dataDir, record.sessionId, record.runId), record);
  }

  private async persistAt(file: string, record: ConvectionRunSnapshot): Promise<void> {
    try {
      await fs.mkdir(convectionRunsDir(this.dataDir), { recursive: true });
      await atomicWriteFile(file, JSON.stringify(record, null, 2));
    } catch (error) {
      throw storageError('CONVECTION_RUN_WRITE_FAILED', '对流轮次记录写入失败', error);
    }
  }
}

function compareRuns(left: ConvectionRunSnapshot, right: ConvectionRunSnapshot): number {
  return left.startedAt.localeCompare(right.startedAt)
    || left.updatedAt.localeCompare(right.updatedAt)
    || left.runId.localeCompare(right.runId);
}

function parseRecord(value: unknown): ConvectionRunSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record');
  const record = value as Partial<ConvectionRunSnapshot>;
  const statuses: ConvectionRunStatus[] = ['running', 'completed', 'aborted', 'failed', 'crashed'];
  if (!identifier(record.sessionId) || !identifier(record.runId)
    || (record.round !== 'public' && record.round !== 'chair')
    || !record.status || !statuses.includes(record.status)
    || !timestamp(record.startedAt) || !timestamp(record.updatedAt)
    || (record.error !== undefined && typeof record.error !== 'string')
    || (record.agentIds !== undefined && (!Array.isArray(record.agentIds)
      || record.agentIds.some(id => !identifier(id))))) throw new Error('fields');
  return record as ConvectionRunSnapshot;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw storageError('CONVECTION_RUN_ID_INVALID', '对流轮次标识无效');
  }
  return value;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function runChanged() {
  return frameworkError({ code: 'CONVECTION_RUN_CHANGED', kind: 'conflict',
    message: '对流轮次已经变化', source: 'convection.runs', retryable: false });
}

function storageError(code: string, message: string, cause?: unknown) {
  return frameworkError({ code, kind: 'io', message,
    source: 'convection.runs', retryable: false }, cause === undefined ? undefined : { cause });
}
