import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { tideTasksFile } from '../../../services/data-paths.js';
import { parseTideTask, parseTideTaskList, type TideTask } from '../domain/task.js';
import type { TideChangeFeed } from '../application/change-feed.js';

const mutationQueues = new Map<string, Promise<void>>();

export interface TideTaskSnapshot {
  tasks: TideTask[];
  revision: string;
}

export interface TideTaskRepository {
  read(): Promise<TideTaskSnapshot>;
  get(taskId: string): Promise<TideTask | undefined>;
  upsert(task: TideTask): Promise<void>;
  mutate(taskId: string, change: (current: TideTask) => TideTask): Promise<TideTask | undefined>;
  reschedule(taskId: string, expected: { schedule: string; nextRun?: string }, nextRun: string): Promise<boolean>;
  remove(taskId: string): Promise<boolean>;
}

export class FileTideTaskRepository implements TideTaskRepository {
  private readonly file: string;

  constructor(dataDir: string, private readonly changes?: TideChangeFeed) {
    this.file = tideTasksFile(dataDir);
  }

  async read(): Promise<TideTaskSnapshot> {
    const raw = await readTaskFile(this.file);
    if (raw === null) return snapshot([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(raw));
    } catch (error) {
      const quarantined = await quarantine(this.file);
      throw frameworkError({
        code: 'TIDE_TASKS_CORRUPT', kind: 'io',
        message: quarantined ? '潮汐任务文件损坏，原文件已隔离' : '潮汐任务文件损坏，且无法隔离原文件',
        source: 'tide.repository', retryable: false,
        details: { quarantined },
      }, { cause: error });
    }
    return snapshot(parseTideTaskList(parsed));
  }

  async get(taskId: string): Promise<TideTask | undefined> {
    const task = (await this.read()).tasks.find(item => item.id === taskId);
    return task ? structuredClone(task) : undefined;
  }

  async upsert(task: TideTask): Promise<void> {
    const valid = parseTideTask(task);
    await serializeFile(this.file, async () => {
      const current = await this.read();
      const index = current.tasks.findIndex(item => item.id === valid.id);
      if (index >= 0) current.tasks[index] = valid;
      else current.tasks.push(valid);
      await this.write(current.tasks);
      this.changes?.publish({ scope: 'task', taskId: valid.id, agentId: valid.agentId });
    });
  }

  async remove(taskId: string): Promise<boolean> {
    return serializeFile(this.file, async () => {
      const current = await this.read();
      const removed = current.tasks.find(task => task.id === taskId);
      const tasks = current.tasks.filter(task => task.id !== taskId);
      if (tasks.length === current.tasks.length) return false;
      await this.write(tasks);
      if (removed) this.changes?.publish({ scope: 'task', taskId, agentId: removed.agentId });
      return true;
    });
  }

  /** Read, change and persist under the same file lock; never resurrect a removed task. */
  async mutate(taskId: string, change: (current: TideTask) => TideTask): Promise<TideTask | undefined> {
    return serializeFile(this.file, async () => {
      const current = await this.read();
      const index = current.tasks.findIndex(task => task.id === taskId);
      if (index < 0) return undefined;
      const before = current.tasks[index];
      const changed = parseTideTask(change(structuredClone(before)));
      if (changed.id !== taskId) throw frameworkError({
        code: 'TIDE_TASK_ID_CHANGED', kind: 'validation', message: '潮汐任务更新不能更改任务 ID',
        source: 'tide.repository', retryable: false,
      });
      if (JSON.stringify(before) !== JSON.stringify(changed)) {
        current.tasks[index] = changed;
        await this.write(current.tasks);
        this.changes?.publish({ scope: 'task', taskId, agentId: changed.agentId });
      }
      return structuredClone(changed);
    });
  }

  /** Advance only the observed schedule; never overwrite a concurrent task edit with a stale snapshot. */
  async reschedule(taskId: string, expected: { schedule: string; nextRun?: string }, nextRun: string): Promise<boolean> {
    if (!Number.isFinite(Date.parse(nextRun))) throw frameworkError({
      code: 'TIDE_NEXT_RUN_INVALID', kind: 'validation', message: '潮汐下次触发时间无效',
      source: 'tide.repository', retryable: false,
    });
    return serializeFile(this.file, async () => {
      const current = await this.read();
      const task = current.tasks.find(item => item.id === taskId);
      if (!task?.enabled || task.repeatCount === 0 || task.schedule !== expected.schedule
        || task.nextRun !== expected.nextRun) return false;
      task.nextRun = nextRun;
      await this.write(current.tasks);
      this.changes?.publish({ scope: 'task', taskId, agentId: task.agentId });
      return true;
    });
  }

  private async write(tasks: TideTask[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await atomicWriteFile(this.file, JSON.stringify(tasks, null, 2));
  }

}

async function serializeFile<T>(file: string, work: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  mutationQueues.set(file, current);
  await previous.catch(() => {});
  try {
    return await work();
  } finally {
    release();
    if (mutationQueues.get(file) === current) mutationQueues.delete(file);
  }
}

async function readTaskFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw frameworkError({
      code: 'TIDE_TASKS_READ_FAILED', kind: 'io',
      message: '无法读取潮汐任务文件', source: 'tide.repository', retryable: false,
    }, { cause: error });
  }
}

async function quarantine(file: string): Promise<boolean> {
  const target = `${file}.corrupt-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  try {
    await fs.rename(file, target);
    return true;
  } catch {
    return false;
  }
}

function snapshot(tasks: TideTask[]): TideTaskSnapshot {
  const copy = structuredClone(tasks);
  const revision = createHash('sha256').update(JSON.stringify(copy)).digest('hex').slice(0, 16);
  return { tasks: copy, revision };
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}
