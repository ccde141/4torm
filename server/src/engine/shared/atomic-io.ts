/**
 * 共享底层原子写原语（信风 / shared 层通用）。
 *
 * 为每次写入创建独立临时文件，再 rename 替换目标；同一进程内按目标路径串行写入。
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const writeQueues = new Map<string, Promise<void>>();
const renameRetryDelays = [20, 40, 80, 160, 320];

async function commitReplacement(tmp: string, filePath: string, signal?: AbortSignal): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    // A failed Windows rename can leave the same complete temporary file available for retry.
    signal?.throwIfAborted();
    try {
      await fs.rename(tmp, filePath);
      return;
    } catch (error) {
      if (process.platform !== 'win32' || attempt >= renameRetryDelays.length
        || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      const directoryTarget = await fs.lstat(filePath).then(stat => stat.isDirectory(), () => false);
      if (directoryTarget) throw error;
      await delay(renameRetryDelays[attempt], undefined, { signal }).catch(waitError => {
        signal?.throwIfAborted();
        throw waitError;
      });
    }
  }
}

async function replaceFile(filePath: string, data: string, signal?: AbortSignal): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    await fs.writeFile(tmp, data, 'utf-8');
    // Cancellation is admissible until replacement; after rename the durable commit wins.
    await commitReplacement(tmp, filePath, signal);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function atomicWriteFile(filePath: string, data: string, signal?: AbortSignal): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => replaceFile(filePath, data, signal));
  writeQueues.set(filePath, current);
  try {
    await current;
  } finally {
    if (writeQueues.get(filePath) === current) writeQueues.delete(filePath);
  }
}

export async function drainAtomicWrites(): Promise<void> {
  while (writeQueues.size > 0) {
    await Promise.all([...writeQueues.values()]);
  }
}
