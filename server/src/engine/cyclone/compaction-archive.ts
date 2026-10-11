import { randomUUID } from 'node:crypto';
import { atomicWrite, cycloneArchiveFile, ensureDir, workshopBakDir } from './paths.js';

/** Unique archives are written before model work; failures never overwrite an earlier attempt. */
export async function archiveCycloneCompaction(
  dataDir: string, workshopId: string, target: string, payload: unknown,
): Promise<string> {
  await ensureDir(workshopBakDir(dataDir, workshopId));
  const file = cycloneArchiveFile(dataDir, workshopId,
    `${Date.now()}-${randomUUID()}-${target}-compact.json`);
  await atomicWrite(file, JSON.stringify(payload));
  return file;
}
