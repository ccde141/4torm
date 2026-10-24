import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

interface CheckpointData {
  version: 1;
  signature: string;
  entries: Record<string, string>;
}

export interface SummaryCheckpoint {
  read(key: string): string | undefined;
  save(key: string, summary: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export function summaryHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Recomputable compaction work only. Conversation stores remain owned by their feature. */
export async function openSummaryCheckpoint(dataDir: string, scope: string | undefined,
  model: string, signature: string): Promise<SummaryCheckpoint | undefined> {
  if (!scope || !dataDir) return;
  const file = path.join(dataDir, 'runtime', 'compaction', `${summaryHash(JSON.stringify([scope, model]))}.json`);
  let data: CheckpointData = { version: 1, signature, entries: {} };
  try {
    const loaded: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!validCheckpoint(loaded)) throw new Error('Invalid compaction checkpoint');
    if (loaded.signature === signature) data = loaded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (!(error instanceof SyntaxError) && !(error instanceof Error && error.message === 'Invalid compaction checkpoint')) throw error;
      const quarantined = `${file}.invalid-${Date.now()}`;
      await fs.rename(file, quarantined);
      console.warn('[compaction] 损坏的压缩检查点已隔离，原会话不受影响', quarantined);
    }
  }
  const persist = async (next: CheckpointData) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next), { flag: 'wx' });
      await fs.rename(temporary, file);
      data = next;
    } finally { await fs.rm(temporary, { force: true }); }
  };
  return { read: key => data.entries[key],
    save: (key, summary) => persist({ ...data, entries: { ...data.entries, [key]: summary } }),
    remove: async keys => {
      const entries = { ...data.entries };
      for (const key of keys) delete entries[key];
      await persist({ ...data, entries });
    } };
}

function validCheckpoint(value: unknown): value is CheckpointData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<CheckpointData>;
  return data.version === 1 && typeof data.signature === 'string' && !!data.entries
    && typeof data.entries === 'object' && !Array.isArray(data.entries)
    && Object.values(data.entries).every(entry => typeof entry === 'string' && !!entry.trim());
}
