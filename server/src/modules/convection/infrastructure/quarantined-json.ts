import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';

export async function readConvectionJson<T>(file: string): Promise<T | null> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await assertNotQuarantined(file);
    return null;
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try { return JSON.parse(raw) as T; }
  catch (cause) {
    try { await fs.rename(file, `${file}.corrupt-${Date.now().toString(36)}-${randomUUID()}`); }
    catch (error) { throw storeError('CONVECTION_STORE_QUARANTINE_FAILED', '损坏数据无法隔离', error); }
    throw storeError('CONVECTION_STORE_CORRUPT', '对流持久化数据已损坏并隔离', cause);
  }
}

async function assertNotQuarantined(file: string): Promise<void> {
  let entries: string[];
  try { entries = await fs.readdir(path.dirname(file)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  // The preserved source is a durable damage marker, including across restarts.
  // Only explicitly restoring the primary file makes this record usable again.
  if (entries.some(name => name.startsWith(`${path.basename(file)}.corrupt-`))) {
    throw storeError('CONVECTION_STORE_CORRUPT', '对流持久化数据已隔离，恢复前不能作为空数据读取');
  }
}

function storeError(code: string, message: string, cause?: unknown): Error {
  return frameworkError({ code, kind: 'io', message, source: 'convection.store', retryable: false },
    cause === undefined ? undefined : { cause });
}
