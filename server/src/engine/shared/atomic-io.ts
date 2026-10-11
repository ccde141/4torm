/**
 * 共享底层原子写原语（信风 / shared 层通用）。
 *
 * 为每次写入创建独立临时文件，再 rename 替换目标；同一进程内按目标路径串行写入。
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const writeQueues = new Map<string, Promise<void>>();

async function replaceFile(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data, 'utf-8');
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => replaceFile(filePath, data));
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
