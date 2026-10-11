import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { readSessionDir, readSessionJson, removeSessionPath, statSessionPath } from './session-io.js';
import { tideSessionRoot, tideTaskSessionDir } from './session-paths.js';
import { assertLegacyMigrationOwnership, legacyNameMatchesTask } from './legacy-session-ownership.js';

export async function updateTideSessionIndex(dir: string, sessionId: string): Promise<void> {
  const file = path.join(dir, '_index.json');
  const existing = await readSessionJson<string[]>(file, '潮汐会话索引');
  const index = Array.isArray(existing) ? existing : [];
  if (index.includes(sessionId)) return;
  index.push(sessionId);
  await atomicWriteFile(file, JSON.stringify(index, null, 2));
}

export async function migrateOldTideSessions(
  dataDir: string,
  agentId: string,
  taskId: string,
  taskName: string,
): Promise<void> {
  const root = tideSessionRoot(dataDir, agentId);
  const entries = await readSessionDir(root, '潮汐根目录');
  if (!entries) return;
  await assertLegacyMigrationOwnership(dataDir, root, agentId, taskId, entries);
  const target = tideTaskSessionDir(dataDir, agentId, taskId, taskName);
  await migrateNamedTaskDirs(entries, root, target, taskId);
  await moveActiveSessions(entries, root, target, taskId);
  await moveArchivedSessions(root, target, taskId);
  await removeSessionPath(path.join(root, '_index.json'));
}

async function migrateNamedTaskDirs(
  entries: string[], root: string, target: string, taskId: string,
): Promise<void> {
  const short = taskId.replace('tide-', '').slice(0, 12);
  for (const name of entries) {
    if (!name.endsWith(`_${short}`)) continue;
    const source = path.join(root, name);
    if (!(await statSessionPath(source, '潮汐旧任务目录'))?.isDirectory()) continue;
    await fs.mkdir(target, { recursive: true });
    await moveNamedTaskContents(source, target);
    await fs.rmdir(source);
  }
}

async function moveNamedTaskContents(source: string, target: string): Promise<void> {
  for (const name of await readSessionDir(source, '潮汐旧任务目录') ?? []) {
    if (name === '_index.json') continue;
    if (name === 'bak') {
      await moveNamedArchives(path.join(source, name), path.join(target, name));
      continue;
    }
    if (!name.endsWith('.json')) continue;
    await moveNamedSession(path.join(source, name), path.join(target, name));
    await updateTideSessionIndex(target, name.slice(0, -5));
  }
  await removeSessionPath(path.join(source, '_index.json'));
}

async function moveNamedSession(source: string, target: string): Promise<void> {
  const incoming = await readSessionJson<{ updatedAt: string }>(source, '潮汐旧任务会话');
  if (!incoming) return;
  const current = await readSessionJson<{ updatedAt: string }>(target, '潮汐会话');
  if (!current) await fs.rename(source, target);
  else {
    if (incoming.updatedAt > current.updatedAt) {
      await atomicWriteFile(target, JSON.stringify(incoming, null, 2));
    } else if (incoming.updatedAt === current.updatedAt
      && JSON.stringify(incoming) !== JSON.stringify(current)) {
      throw new Error('同一潮汐会话的旧目录内容冲突');
    }
    await fs.unlink(source);
  }
}

async function moveNamedArchives(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  for (const name of await readSessionDir(source, '潮汐旧归档目录') ?? []) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    if (!(await statSessionPath(to, '潮汐归档文件'))) await fs.rename(from, to);
    else {
      const [previous, incoming] = await Promise.all([fs.readFile(to), fs.readFile(from)]);
      if (!previous.equals(incoming)) throw new Error(`同名潮汐归档内容冲突: ${name}`);
      await fs.unlink(from);
    }
  }
  await fs.rmdir(source);
}

async function moveActiveSessions(
  entries: string[],
  root: string,
  target: string,
  taskId: string,
): Promise<void> {
  for (const name of entries) {
    if (!name.endsWith('.json') || name === '_index.json') continue;
    const source = path.join(root, name);
    const stat = await statSessionPath(source, '潮汐旧会话文件');
    const sessionId = name.replace(/\.json$/, '');
    if (!stat?.isFile() || !belongsToTask(sessionId, taskId)) continue;
    await fs.mkdir(target, { recursive: true });
    await moveFile(source, path.join(target, name));
    await updateTideSessionIndex(target, sessionId);
  }
}

async function moveArchivedSessions(root: string, target: string, taskId: string): Promise<void> {
  const oldBak = path.join(root, 'bak');
  const names = await readSessionDir(oldBak, '潮汐旧 bak 目录');
  if (!names) return;
  const targetBak = path.join(target, 'bak');
  for (const name of names) {
    const source = path.join(oldBak, name);
    const stat = await statSessionPath(source, '潮汐旧 bak 文件');
    if (!stat?.isFile() || !belongsToTask(name, taskId)) continue;
    await fs.mkdir(targetBak, { recursive: true });
    await moveFile(source, path.join(targetBak, name));
  }
  if ((await readSessionDir(oldBak, '潮汐旧 bak 目录'))?.length === 0) {
    await removeSessionPath(oldBak);
  }
}

function belongsToTask(name: string, taskId: string): boolean {
  return legacyNameMatchesTask(name, taskId);
}

async function moveFile(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target);
  } catch {
    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
}
