import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { tideRuntimeDir } from '../../../services/data-paths.js';
import { OperationNotifier } from '../../../engine/collaboration/operation-notifier.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { CompactionProgress } from '../../../engine/shared/compaction/index.js';
import { parseTideCompactionProgress } from '../domain/compaction-progress.js';
import { recoverTideCompaction } from './compaction-recovery.js';
import { advanceTideUsage } from '../domain/token-usage.js';
import type { TideChangeFeed } from '../application/change-feed.js';
import { staleState, corruptState, runtimeIoError } from './run-state-errors.js';
import {
  parseTideRunState,
  type TideRunState,
  type TideRunStatus,
  type TideRunTrigger,
} from '../domain/run-state.js';

export interface TideRunStateRepository {
  create(taskId: string, trigger: TideRunTrigger, agentId?: string, acknowledgeNotice?: boolean): Promise<TideRunState>;
  get(taskId: string): Promise<TideRunState | null>;
  getRun(taskId: string, runId: string): Promise<TideRunState | null>;
  listAll(): Promise<TideRunState[]>;
  removeTask(taskId: string): Promise<void>;
  markRunning(taskId: string, runId: string, agentId?: string): Promise<TideRunState>;
  recordUsage(taskId: string, runId: string, usage: TokenUsage | null): Promise<TideRunState>;
  recordCompactionNotice(taskId: string, runId: string, message: string): Promise<TideRunState>;
  recordCompactionProgress(taskId: string, runId: string, event: CompactionProgress,
    sessionId?: string, sourceRevision?: number): Promise<TideRunState>;
  acknowledgeCompactionNotice(taskId: string): Promise<void>;
  finish(
    taskId: string,
    runId: string,
    status: Extract<TideRunStatus, 'completed' | 'failed' | 'aborted'>,
    error?: { code: string; message: string },
  ): Promise<TideRunState>;
  recoverCrashed(): Promise<number>;
  subscribe(taskId: string, runId: string, listener: () => void): () => void;
}

export class FileTideRunStateRepository implements TideRunStateRepository {
  private readonly notifier = new OperationNotifier();
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(private readonly dataDir: string, private readonly changes?: TideChangeFeed) {}

  create(taskId: string, trigger: TideRunTrigger, agentId?: string, acknowledgeNotice = false): Promise<TideRunState> {
    return this.serial(taskId, async () => {
      const previous = await this.get(taskId);
      const instant = Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0);
      const now = new Date(instant).toISOString();
      const state: TideRunState = {
        schemaVersion: 1, taskId, trigger, status: 'queued',
        runId: `tide-run-${randomUUID()}`, createdAt: now, updatedAt: now,
        ...(agentId ? { agentId } : {}),
        // "manual" also includes Agent tools; only trusted human admission acknowledges a notice.
        ...(!acknowledgeNotice && previous?.compactionNotice
          ? { compactionNotice: previous.compactionNotice } : {}),
      };
      await this.write(state);
      this.notifier.publish({ operationId: taskId, runId: state.runId });
      this.changes?.publish({ scope: 'run', taskId, runId: state.runId, agentId });
      return structuredClone(state);
    });
  }

  async get(taskId: string): Promise<TideRunState | null> {
    const files = await this.taskFiles(taskId);
    const file = files[0] ?? this.legacyFile(taskId);
    const state = await this.readOptional(file);
    if (state && state.taskId !== taskId) throw corruptState(file,
      new Error('taskId mismatch'));
    return state;
  }

  async getRun(taskId: string, runId: string): Promise<TideRunState | null> {
    const files = await this.taskFiles(taskId);
    const file = files.find(item => path.basename(item).endsWith(`-${runId}.json`));
    const state = await this.readOptional(file ?? this.legacyFile(taskId));
    if (state && state.taskId !== taskId) throw corruptState(file ?? this.legacyFile(taskId),
      new Error('taskId mismatch'));
    return state?.runId === runId ? state : null;
  }

  async listAll(): Promise<TideRunState[]> {
    return Promise.all((await this.files()).map(file => this.readFile(file)));
  }

  async removeTask(taskId: string): Promise<void> {
    try {
      await fs.rm(this.taskDir(taskId), { recursive: true, force: true });
      await fs.rm(this.legacyFile(taskId), { force: true });
    } catch (error) {
      throw frameworkError({
        code: 'TIDE_RUN_STATE_DELETE_FAILED', kind: 'io',
        message: '无法删除潮汐运行事实', source: 'tide.run-state', retryable: false,
        details: { taskId },
      }, { cause: error });
    }
  }

  private async readOptional(file: string): Promise<TideRunState | null> {
    try {
      return parseTideRunState(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw corruptState(file, error);
    }
  }

  async markRunning(taskId: string, runId: string, agentId?: string): Promise<TideRunState> {
    return this.update(taskId, runId, state => {
      const now = new Date().toISOString();
      return { ...state, status: 'running', startedAt: now, updatedAt: now,
        ...(agentId ? { agentId } : {}) };
    });
  }

  recordUsage(taskId: string, runId: string, usage: TokenUsage | null): Promise<TideRunState> {
    return this.update(taskId, runId, state => ({ ...state,
      usage: advanceTideUsage(state.usage, usage), updatedAt: new Date().toISOString() }));
  }

  recordCompactionNotice(taskId: string, runId: string, message: string): Promise<TideRunState> {
    if (!message.trim()) throw new Error('潮汐压缩提示不能为空');
    return this.update(taskId, runId, state => ({ ...state,
      compactionNotice: message, updatedAt: new Date().toISOString() }));
  }

  recordCompactionProgress(taskId: string, runId: string, event: CompactionProgress,
    sessionId?: string, sourceRevision?: number): Promise<TideRunState> {
    const compaction = parseTideCompactionProgress(event);
    return this.update(taskId, runId, state => ({ ...state, compaction,
      ...(sessionId ? { compactionSessionId: sessionId } : {}),
      ...(event.type === 'compact-start' && sourceRevision !== undefined
        ? { compactionSourceRevision: sourceRevision } : {}), updatedAt: new Date().toISOString() }));
  }

  acknowledgeCompactionNotice(taskId: string): Promise<void> {
    return this.serial(taskId, async () => {
      const current = await this.get(taskId);
      if (!current?.compactionNotice) return;
      await this.updateState(taskId, current.runId, state => {
        const next = { ...state, updatedAt: new Date().toISOString() };
        delete next.compactionNotice;
        return next;
      });
    });
  }

  async finish(
    taskId: string,
    runId: string,
    status: 'completed' | 'failed' | 'aborted',
    error?: { code: string; message: string },
  ): Promise<TideRunState> {
    const current = await this.getRun(taskId, runId);
    const settled = current && await recoverTideCompaction(this.dataDir, current, new Date().toISOString());
    return this.update(taskId, runId, state => {
      const now = new Date().toISOString();
      const finished: TideRunState = { ...state, status, updatedAt: now, finishedAt: now };
      if (state.compaction?.type === 'compact-start' && settled?.compaction?.id === state.compaction.id) {
        finished.compaction = settled.compaction;
      }
      if (error) {
        finished.errorCode = error.code;
        finished.errorMessage = error.message;
      }
      return finished;
    });
  }

  async recoverCrashed(): Promise<number> {
    let recovered = 0;
    for (const file of await this.files()) {
      const state = await this.readFile(file);
      if (state.status !== 'queued' && state.status !== 'running') continue;
      const now = new Date().toISOString();
      const recoveredState = await recoverTideCompaction(this.dataDir, state, now);
      await this.writeAt(file, { ...recoveredState, status: 'crashed', updatedAt: now, finishedAt: now });
      this.notifier.publish({ operationId: state.taskId, runId: state.runId });
      this.changes?.publish({ scope: 'run', taskId: state.taskId,
        runId: state.runId, agentId: state.agentId });
      recovered += 1;
    }
    return recovered;
  }

  subscribe(taskId: string, runId: string, listener: () => void): () => void {
    return this.notifier.subscribe({ operationId: taskId, runId }, listener);
  }

  private async update(
    taskId: string,
    runId: string,
    change: (state: TideRunState) => TideRunState,
  ): Promise<TideRunState> {
    return this.serial(taskId, () => this.updateState(taskId, runId, change));
  }

  private async updateState(taskId: string, runId: string,
    change: (state: TideRunState) => TideRunState): Promise<TideRunState> {
    const current = await this.get(taskId);
    if (!current || current.runId !== runId) throw staleState(taskId, runId);
    const updated = change(current);
    const file = (await this.taskFiles(taskId))[0] ?? this.legacyFile(taskId);
    await this.writeAt(file, updated);
    this.notifier.publish({ operationId: taskId, runId });
    this.changes?.publish({ scope: 'run', taskId, runId, agentId: updated.agentId });
    return structuredClone(updated);
  }

  private async serial<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(taskId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(work);
    this.writes.set(taskId, pending);
    try { return await pending; }
    finally { if (this.writes.get(taskId) === pending) this.writes.delete(taskId); }
  }

  private async files(): Promise<string[]> {
    const dir = tideRuntimeDir(this.dataDir);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const legacy = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => path.join(dir, entry.name));
      const nested = await Promise.all(entries.filter(entry => entry.isDirectory())
        .map(entry => this.filesIn(path.join(dir, entry.name))));
      return [...legacy, ...nested.flat()];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw runtimeIoError(error);
    }
  }

  private async taskFiles(taskId: string): Promise<string[]> {
    return (await this.filesIn(this.taskDir(taskId))).sort().reverse();
  }

  private async filesIn(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir)).filter(name => name.endsWith('.json'))
        .map(name => path.join(dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw runtimeIoError(error);
    }
  }

  private async readFile(file: string): Promise<TideRunState> {
    try {
      return parseTideRunState(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      throw corruptState(file, error);
    }
  }

  private async write(state: TideRunState): Promise<void> {
    await this.writeAt(this.runFile(state), state);
  }

  private async writeAt(file: string, state: TideRunState): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, JSON.stringify(state, null, 2));
  }

  private taskDir(taskId: string): string {
    const name = createHash('sha256').update(taskId).digest('hex');
    return path.join(tideRuntimeDir(this.dataDir), name);
  }

  private legacyFile(taskId: string): string {
    return `${this.taskDir(taskId)}.json`;
  }

  private runFile(state: TideRunState): string {
    const timestamp = new Date(state.createdAt).toISOString().replace(/[-:.]/g, '');
    return path.join(this.taskDir(state.taskId), `${timestamp}-${state.runId}.json`);
  }
}
