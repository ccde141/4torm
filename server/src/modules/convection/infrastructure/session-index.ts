import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { convectionSessionIndexFile, convectionSessionsDir } from '../../../services/data-paths.js';
import { readConvectionJson } from './quarantined-json.js';
import type { ConvectionSessionData } from './session-store.js';

async function ensureDir(dir: string): Promise<void> { await fs.mkdir(dir, { recursive: true }); }

const indexQueues = new Map<string, Promise<void>>();

export async function readIndex(dataDir: string): Promise<string[]> {
  let index: string[] = [];
  await withIndexLock(dataDir, async () => { index = await reconcileIndex(dataDir); });
  return index;
}

async function reconcileIndex(dataDir: string): Promise<string[]> {
  const file = convectionSessionIndexFile(dataDir);
  const value = await readConvectionJson<unknown>(convectionSessionIndexFile(dataDir));
  if (value !== null && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
    throw storeError('CONVECTION_STORE_INVALID', '对流会话索引格式无效');
  }
  const index = [...new Set((value ?? []) as string[])];
  let entries: string[];
  try { entries = await fs.readdir(convectionSessionsDir(dataDir)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return index;
    throw error;
  }
  for (const name of entries) {
    if (name.startsWith('_') || !name.endsWith('.json') || index.includes(name.slice(0, -5))) continue;
    const primary = path.join(convectionSessionsDir(dataDir), name);
    const candidate = await readConvectionJson<unknown>(primary);
    if (candidate === null) {
      try { await fs.access(primary); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    }
    if (!isSession(candidate, name.slice(0, -5))) {
      throw storeError('CONVECTION_STORE_INVALID', `对流会话主文件格式无效：${name}`);
    }
    index.push(candidate.id);
  }
  if (entries.some(name => !name.startsWith('_') && name.includes('.json.corrupt-')
    && !entries.includes(name.slice(0, name.indexOf('.json.corrupt-') + 5)))) {
    throw storeError('CONVECTION_STORE_CORRUPT', '对流会话主文件已隔离，恢复前不能重建索引');
  }
  if (index.length !== (value?.length ?? 0)) await atomicWriteFile(file, JSON.stringify(index));
  return index;
}

function isSession(value: unknown, id: string): value is ConvectionSessionData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.id === id && typeof candidate.title === 'string'
    && Array.isArray(candidate.publicMessages) && Array.isArray(candidate.chairMessages)
    && typeof candidate.createdAt === 'string' && typeof candidate.updatedAt === 'string';
}

export async function mutateIndex(
  dataDir: string,
  mutate: (index: string[]) => string[],
): Promise<void> {
  const file = convectionSessionIndexFile(dataDir);
  await withIndexLock(dataDir, async () => {
    await ensureDir(convectionSessionsDir(dataDir));
    const next = [...new Set(mutate(await reconcileIndex(dataDir)))];
    await atomicWriteFile(file, JSON.stringify(next));
  });
}

async function withIndexLock(dataDir: string, operation: () => Promise<void>): Promise<void> {
  const file = convectionSessionIndexFile(dataDir);
  const previous = indexQueues.get(file) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  indexQueues.set(file, current);
  try {
    await current;
  } finally {
    if (indexQueues.get(file) === current) indexQueues.delete(file);
  }
}

function storeError(code: string, message: string, cause?: unknown) {
  return frameworkError({ code, kind: 'io', message, source: 'convection.store', retryable: false },
    cause === undefined ? undefined : { cause });
}
