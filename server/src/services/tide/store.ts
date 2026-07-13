/**
 * 潮汐 — 任务 & 运行记录持久化
 *
 * 文件布局：
 *   data/tide/tasks.json          — TideTask[]
 *   data/tide/runs/{taskId}/{ts}.json — TideRunRecord
 *
 * 会话持久化见 session-store.ts（sessions-tide/ + 归档）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TideTask, TideRunRecord } from './types';

/** 原子写：先写 .tmp 再 rename 覆盖，防止进程中途被杀（关软件）时留下半截 JSON 损坏任务表/记录。 */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, 'utf-8');
  await fs.rename(tmp, filePath);
}

// ── Tasks CRUD ──────────────────────────────────────────────────

function tasksFile(dataDir: string): string {
  return path.join(dataDir, 'tide', 'tasks.json');
}

export async function loadTasks(dataDir: string): Promise<TideTask[]> {
  try {
    const raw = await fs.readFile(tasksFile(dataDir), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveTasks(dataDir: string, tasks: TideTask[]): Promise<void> {
  const dir = path.join(dataDir, 'tide');
  await fs.mkdir(dir, { recursive: true });
  await atomicWrite(tasksFile(dataDir), JSON.stringify(tasks, null, 2));
}

export async function getTask(dataDir: string, taskId: string): Promise<TideTask | undefined> {
  const tasks = await loadTasks(dataDir);
  return tasks.find(t => t.id === taskId);
}

export async function upsertTask(dataDir: string, task: TideTask): Promise<void> {
  const tasks = await loadTasks(dataDir);
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  await saveTasks(dataDir, tasks);
}

export async function deleteTask(dataDir: string, taskId: string): Promise<void> {
  const tasks = await loadTasks(dataDir);
  await saveTasks(dataDir, tasks.filter(t => t.id !== taskId));
  // 同时删除运行记录目录
  const runsDir = path.join(dataDir, 'tide', 'runs', taskId);
  await fs.rm(runsDir, { recursive: true, force: true });
}

// ── Run Records ─────────────────────────────────────────────────

export async function saveRunRecord(dataDir: string, record: TideRunRecord): Promise<void> {
  const dir = path.join(dataDir, 'tide', 'runs', record.taskId);
  await fs.mkdir(dir, { recursive: true });
  const safeTs = record.timestamp.replace(/:/g, '-');
  const file = path.join(dir, `${safeTs}.json`);
  await atomicWrite(file, JSON.stringify(record, null, 2));
}

export async function listRunRecords(
  dataDir: string,
  taskId: string,
  limit = 10,
): Promise<TideRunRecord[]> {
  const dir = path.join(dataDir, 'tide', 'runs', taskId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  // 按文件名降序（时间戳 ISO → 最新在前）
  files = files.filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit);
  const records: TideRunRecord[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf-8');
      records.push(JSON.parse(raw));
    } catch { /* skip corrupt */ }
  }
  return records;
}
