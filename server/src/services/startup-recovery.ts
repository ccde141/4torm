import fs from 'node:fs/promises';
import path from 'node:path';
import { healAgentLocks } from '../engine/shared/agent-lock.js';
import { ArchiveManager } from '../engine/tradewind/orchestrator/archive-manager.js';
import { tradewindRunsDir } from './data-paths.js';

export interface StartupRecoveryResult {
  releasedAgents: string[];
  crashedRuns: number;
  removedTempFiles: number;
}

const CONTROL_DIRS = ['agents', 'convection', 'tide', 'cyclone', 'tradewind', 'mcp', 'tools'];
const SKIPPED_DIRS = new Set(['workspace', '.workspace', 'executors']);
const ATOMIC_TEMP = /\.\d+\.[0-9a-f-]{36}\.tmp$/i;
const STORAGE_TEMP = /\.\d+\.\d+\.[a-z0-9]{6}\.tmp$/i;
const LEGACY_TASKBOARD_TEMP = /\.taskboard\.json\.tmp$/i;

function isFrameworkTempFile(name: string): boolean {
  return ATOMIC_TEMP.test(name) || STORAGE_TEMP.test(name) || LEGACY_TASKBOARD_TEMP.test(name);
}

async function readEntries(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function removeTempsInDir(dir: string): Promise<number> {
  let removed = 0;
  for (const entry of await readEntries(dir)) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name.toLowerCase())) removed += await removeTempsInDir(target);
    } else if (entry.isFile() && isFrameworkTempFile(entry.name)) {
      await fs.rm(target, { force: true });
      removed++;
    }
  }
  return removed;
}

export async function cleanupFrameworkTempFiles(dataDir: string): Promise<number> {
  let removed = 0;
  for (const entry of await readEntries(dataDir)) {
    if (entry.isFile() && isFrameworkTempFile(entry.name)) {
      await fs.rm(path.join(dataDir, entry.name), { force: true });
      removed++;
    }
  }
  for (const dir of CONTROL_DIRS) removed += await removeTempsInDir(path.join(dataDir, dir));
  return removed;
}

export async function recoverStartupState(dataDir: string): Promise<StartupRecoveryResult> {
  const [releasedAgents, crashedRuns, removedTempFiles] = await Promise.all([
    healAgentLocks(dataDir),
    ArchiveManager.healCrashed(tradewindRunsDir(dataDir)),
    cleanupFrameworkTempFiles(dataDir),
  ]);
  return { releasedAgents, crashedRuns, removedTempFiles };
}
