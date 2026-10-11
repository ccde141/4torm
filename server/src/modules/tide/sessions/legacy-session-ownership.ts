import { tideTasksFile } from '../../../services/data-paths.js';
import { parseTideTaskList, type TideTask } from '../domain/task.js';
import { ambiguousTideSession, readSessionDir, readSessionJson } from './session-io.js';
import path from 'node:path';

/** Legacy names contain partial identities. Never move one until its owner is unambiguous. */
export async function assertLegacyMigrationOwnership(dataDir: string, root: string,
  agentId: string, taskId: string, entries: string[]): Promise<void> {
  const names = [...entries, ...(await readSessionDir(path.join(root, 'bak'), '潮汐旧 bak 目录') ?? [])];
  if (!names.some(name => legacyNameMatchesTask(name, taskId))) return;
  const tasks = await knownAgentTasks(dataDir, agentId);
  for (const name of names) {
    const matches = tasks.filter(task => legacyNameMatchesTask(name, task.id)
      || isBoundSessionFile(name, task.targetSessionId));
    if (matches.some(task => task.id === taskId) && matches.length > 1) {
      throw ambiguousTideSession(name);
    }
  }
}

export async function assertLegacySessionOwnership(dataDir: string, agentId: string,
  sessionId: string): Promise<void> {
  const owners = (await knownAgentTasks(dataDir, agentId)).filter(task =>
    task.targetSessionId === sessionId || legacyNameMatchesTask(sessionId, task.id));
  if (owners.length > 1) throw ambiguousTideSession(sessionId);
}

export function legacyNameMatchesTask(name: string, taskId: string): boolean {
  const directorySuffix = taskId.replace(/^tide-/, '').slice(0, 12);
  if (name.endsWith(`_${directorySuffix}`)) return true;
  const payload = name.split('-tide-')[1] ?? '';
  if (payload.startsWith(`${taskId}-`) || payload.startsWith(`${taskId.slice(0, 8)}-`)) return true;
  const short = payload.split('-')[0];
  return short.length > 0 && short === taskId.replace(/^tide-/, '').slice(0, short.length);
}

async function knownAgentTasks(dataDir: string, agentId: string): Promise<TideTask[]> {
  const value = await readSessionJson<unknown>(tideTasksFile(dataDir), '潮汐任务文件');
  return value === null ? [] : parseTideTaskList(value).filter(task => task.agentId === agentId);
}

function isBoundSessionFile(name: string, sessionId?: string): boolean {
  return !!sessionId && (name === `${sessionId}.json` || name.startsWith(`${sessionId}_`)
    || name.startsWith(`${sessionId}.json.bak.`));
}
