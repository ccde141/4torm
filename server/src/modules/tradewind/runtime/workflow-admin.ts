import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { frameworkError, FrameworkError } from '../../../engine/shared/framework-error.js';
import { getActiveTradewindOrchestrator, isTradewindExecutionRunning } from '../../../services/tradewind-execution.js';
import { tradewindRunsDir, tradewindWorkflowDir } from '../../../services/data-paths.js';
import { loadProfiles as readProfiles, saveProfiles } from '../../../engine/tradewind/foundation/profile-store.js';
import type { AutoProfile } from '../../../engine/tradewind/foundation/types/index.js';
import type { SaveWorkflowCommand, TradewindWorkflowAdmin } from '../application/workflow-admin.js';
import type { TradewindWorkflowStore } from '../application/workflow-store.js';
import type { TradewindWorkflowWrites } from '../application/workflow-writes.js';
import { createTradewindWorkflowStore } from './workflow-store.js';
import { createTradewindWorkflowWrites } from './workflow-writes.js';

export interface WorkspaceLauncher { open(workspacePath: string): Promise<void> }

export function createTradewindWorkflowAdmin(
  dataDir: string,
  launcher: WorkspaceLauncher = systemLauncher,
  store: TradewindWorkflowStore = createTradewindWorkflowStore(dataDir),
  writes: TradewindWorkflowWrites = createTradewindWorkflowWrites(store),
): TradewindWorkflowAdmin {
  const locks = new Map<string, Promise<unknown>>();
  return {
    load: workflowId => store.read(workflowId),
    list: () => store.list(),
    save: input => withLock(locks, input.workflowId, () => save(writes, input)),
    delete: (workflowId, expectedRevision) => withLock(locks, workflowId,
      () => remove(writes, dataDir, workflowId, expectedRevision)),
    openWorkspace: workflowId => withLock(locks, workflowId,
      () => openWorkspace(store, dataDir, workflowId, launcher)),
    loadProfiles: async workflowId => {
      await store.read(workflowId);
      try { return await readProfiles(dataDir, workflowId); }
      catch (error) { throw ioError('TRADEWIND_PROFILES_READ_FAILED', '读取循环档案失败', error); }
    },
    saveProfiles: (workflowId, profiles) => withLock(locks, workflowId,
      () => replaceProfiles(store, dataDir, workflowId, profiles)),
    deleteProfile: (workflowId, profileId) => withLock(locks, workflowId,
      () => removeProfile(store, dataDir, workflowId, profileId)),
  };
}

async function replaceProfiles(
  store: TradewindWorkflowStore, dataDir: string, workflowId: string, profiles: AutoProfile[],
) {
  requireWorkflowId(workflowId);
  await store.read(workflowId);
  try {
    await saveProfiles(dataDir, workflowId, profiles);
    return { saved: true as const, count: profiles.length };
  } catch (error) {
    throw ioError('TRADEWIND_PROFILES_SAVE_FAILED', '保存循环档案失败', error);
  }
}

async function removeProfile(
  store: TradewindWorkflowStore, dataDir: string, workflowId: string, profileId: string,
) {
  requireWorkflowId(workflowId); requireProfileId(profileId);
  await store.read(workflowId);
  const profiles = await readProfiles(dataDir, workflowId).catch(error => {
    throw ioError('TRADEWIND_PROFILES_READ_FAILED', '读取循环档案失败', error);
  });
  const next = profiles.filter(profile => profile.id !== profileId);
  if (next.length === profiles.length) {
    throw workflowError('TRADEWIND_PROFILE_NOT_FOUND', 'not_found', `档案不存在：${profileId}`);
  }
  try {
    await saveProfiles(dataDir, workflowId, next);
    return { deleted: true as const, profileId };
  } catch (error) {
    throw ioError('TRADEWIND_PROFILE_DELETE_FAILED', '删除循环档案失败', error);
  }
}

async function save(writes: TradewindWorkflowWrites, input: SaveWorkflowCommand) {
  requireWorkflowId(input.workflowId);
  try {
    const definition = await writes.save(input);
    return { saved: true as const, workflowId: input.workflowId,
      name: input.name, revision: definition.revision };
  } catch (error) {
    if (error instanceof FrameworkError) throw error;
    throw ioError('TRADEWIND_WORKFLOW_SAVE_FAILED', '保存信风工作流失败', error);
  }
}

async function remove(
  writes: TradewindWorkflowWrites, dataDir: string, workflowId: string, expectedRevision: string,
) {
  requireWorkflowId(workflowId);
  if (isTradewindExecutionRunning()
    && getActiveTradewindOrchestrator()?.getWorkflowId() === workflowId) {
    throw workflowError('TRADEWIND_WORKFLOW_RUNNING', 'conflict', '当前工作流正在运行，请先停止后再删除');
  }
  try {
    if (!await writes.remove(workflowId, expectedRevision)) {
      throw workflowError('TRADEWIND_WORKFLOW_NOT_FOUND', 'not_found', '工作流不存在');
    }
    await fs.rm(path.join(tradewindRunsDir(dataDir), workflowId), { recursive: true, force: true });
    return { deleted: true as const, workflowId };
  } catch (error) {
    if (error instanceof FrameworkError) throw error;
    throw ioError('TRADEWIND_WORKFLOW_DELETE_FAILED', '删除信风工作流失败', error);
  }
}

async function openWorkspace(
  store: TradewindWorkflowStore, dataDir: string, workflowId: string, launcher: WorkspaceLauncher,
) {
  requireWorkflowId(workflowId);
  const workflowDir = tradewindWorkflowDir(dataDir, workflowId);
  await store.read(workflowId);
  const workspacePath = path.join(workflowDir, 'workspace');
  try {
    await fs.mkdir(workspacePath, { recursive: true });
    await launcher.open(workspacePath);
    return { opened: true as const, workflowId, path: workspacePath };
  } catch (error) {
    throw ioError('TRADEWIND_WORKSPACE_OPEN_FAILED', '打开信风工作区失败', error);
  }
}

async function withLock<T>(
  locks: Map<string, Promise<unknown>>, key: string, action: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

function requireWorkflowId(workflowId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(workflowId)) {
    throw workflowError('TRADEWIND_WORKFLOW_ID_INVALID', 'validation', '工作流 ID 无效');
  }
}

function requireProfileId(profileId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(profileId)) {
    throw workflowError('TRADEWIND_PROFILE_ID_INVALID', 'validation', '循环档案 ID 无效');
  }
}

function workflowError(code: string, kind: 'validation' | 'not_found' | 'conflict', message: string) {
  return frameworkError({ code, kind, message, source: 'tradewind.workflow', retryable: false });
}

function ioError(code: string, message: string, cause: unknown) {
  return frameworkError({ code, kind: 'io', message, source: 'tradewind.workflow', retryable: false }, { cause });
}

const systemLauncher: WorkspaceLauncher = {
  open: workspacePath => new Promise<void>((resolve, reject) => {
    const command = process.platform === 'win32' ? 'explorer.exe'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [workspacePath], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  }),
};
